const crypto = require("crypto");
const queries = require("../db/queries");
const { getOffers } = require("./reviews");
const {
  COOKIE_NAME,
  ONE_YEAR_MS,
  VISIT_COOLDOWN_MINUTES,
  hashToken,
  getCookie,
  toIso,
  buildOffers,
  isRequestSecure
} = require("./helpers");

const getUserFromRequest = async (request) => {
  const token = getCookie(request, COOKIE_NAME);
  if (!token) {
    return null;
  }
  return await queries.findUserBySession(hashToken(token));
};

const addVisit = async (userId) => {
  const now = new Date();
  const cutoff = new Date(
    now.getTime() - VISIT_COOLDOWN_MINUTES * 60 * 1000
  );

  const result = await queries.incrementUserVisits(userId, now, cutoff);
  const counted = result.affectedRows === 1;

  if (counted) {
    try {
      await queries.insertVisit(userId, now);
    } catch (e) {
      console.log(`Visit Log Error: ${e.message}`);
    }
  }

  return counted;
};

const getStatus = async (userId) => {
  const user = await queries.findUserById(userId);
  if (!user) {
    throw new Error("User not found.");
  }

  const offerList = await getOffers();
  const claimRows = await queries.getUserClaims(userId);

  const claims = new Map(
    claimRows.map((row) => [Number(row.minVisits), toIso(row.claimedAt)])
  );

  return {
    ok: true,
    email: user.email,
    visits: Number(user.visitCount),
    ...buildOffers(Number(user.visitCount), claims, offerList)
  };
};

const signInUser = async (request, response, email) => {
  let user = await queries.findUserByEmail(email);

  if (!user) {
    try {
      const result = await queries.createUser(email);
      user = await queries.findUserById(result.insertId);
    } catch (err) {
      if (err.code === "ER_DUP_ENTRY") {
        user = await queries.findUserByEmail(email);
      } else {
        throw err;
      }
    }
  }

  const token = crypto.randomBytes(32).toString("hex");
  await queries.createSession(hashToken(token), user.id);

  response.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isRequestSecure(request),
    maxAge: ONE_YEAR_MS,
    path: "/"
  });

  const counted = await addVisit(user.id);

  return {
    ...(await getStatus(user.id)),
    newVisit: counted
  };
};

module.exports = {
  getUserFromRequest,
  addVisit,
  getStatus,
  signInUser
};

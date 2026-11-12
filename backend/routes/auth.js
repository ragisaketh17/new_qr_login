const express = require("express");
const router = express.Router();
const queries = require("../db/queries");
const { getOffers } = require("../utils/reviews");
const {
  EMAIL_PATTERN,
  COOKIE_NAME,
  getBaseUrl,
  hashToken,
  getCookie,
  buildOffers
} = require("../utils/helpers");
const {
  hashOtp,
  isOtpExpired,
  sendOtpEmail
} = require("../mail/smtp");
const {
  getUserFromRequest,
  addVisit,
  getStatus,
  signInUser
} = require("../utils/auth");

// --------------------------------------------------
// SCAN
// --------------------------------------------------
router.get("/scan", async (request, response) => {
  response.set("Cache-Control", "no-store");
  let counted = false;

  try {
    const user = await getUserFromRequest(request);
    if (user) {
      counted = await addVisit(user.id);
    }
  } catch (e) {
    console.log(`Scan Error: ${e.message}`);
  }

  response.redirect(counted ? "/?counted=1" : "/");
});

// --------------------------------------------------
// SEND OTP (SMTP)
// --------------------------------------------------
router.post("/api/send-otp", async (request, response) => {
  const email = String(request.body?.email ?? "").trim().toLowerCase();

  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return response.status(400).json({
      error: "Enter a valid email address."
    });
  }

  try {
    await queries.deleteOtpByEmail(email);

    // Opportunistically clean up expired OTPs
    queries.deleteExpiredOtps(Date.now()).catch(() => { });

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = hashOtp(code);
    const expiresAt = Date.now() + 10 * 60 * 1000;

    await queries.insertOtp(email, codeHash, expiresAt);

    const verifyLink = `${getBaseUrl(request)}/verify-otp?email=${encodeURIComponent(email)}&code=${code}`;
    const result = await sendOtpEmail(email, code, verifyLink);

    const message = result.fallback
      ? "Verification code generated! (Note: Email delivery failed. Check your server console/logs for SMTP details)"
      : (result.devMode
        ? "Verification code generated! (Dev Mode: check your terminal console)"
        : "Verification code sent to your email.");

    response.json({
      ok: true,
      devMode: Boolean(result.devMode),
      message
    });
  } catch (e) {
    console.error("Send OTP Error:", e);
    response.status(500).json({
      error: `Could not send verification code: ${e.message}`
    });
  }
});

// --------------------------------------------------
// VERIFY OTP
// --------------------------------------------------
router.post("/api/verify-otp", async (request, response) => {
  const email = String(request.body?.email ?? "").trim().toLowerCase();
  const code = String(request.body?.code ?? "").trim();

  if (!email || !EMAIL_PATTERN.test(email)) {
    return response.status(400).json({
      error: "Enter a valid email address."
    });
  }

  if (!code || !/^\d{6}$/.test(code)) {
    return response.status(400).json({
      error: "Please enter a valid 6-digit code."
    });
  }

  try {
    const codeHash = hashOtp(code);
    const otp = await queries.findLatestOtp(email, codeHash);

    if (!otp) {
      return response.status(400).json({
        error: "Invalid verification code. Please request a new code."
      });
    }

    if (isOtpExpired(otp.expiresAt)) {
      return response.status(400).json({
        error: "Verification code has expired. Please request a new code."
      });
    }

    await queries.deleteOtpByEmail(email);
    const userData = await signInUser(request, response, email);
    response.json(userData);
  } catch (e) {
    console.error("Verify OTP Error:", e);
    response.status(500).json({
      error: `Verification failed: ${e.message}`
    });
  }
});

// --------------------------------------------------
// ONE-CLICK VERIFY LINK (MAGIC LINK)
// --------------------------------------------------
router.get("/verify-otp", async (request, response) => {
  const email = String(request.query?.email ?? "").trim().toLowerCase();
  const code = String(request.query?.code ?? "").trim();

  if (!email || !EMAIL_PATTERN.test(email) || !code || !/^\d{6}$/.test(code)) {
    return response.redirect("/?error=invalid-code");
  }

  try {
    const codeHash = hashOtp(code);
    const otp = await queries.findLatestOtp(email, codeHash);

    if (!otp || isOtpExpired(otp.expiresAt)) {
      return response.redirect("/?error=invalid-code");
    }

    await queries.deleteOtpByEmail(email);
    const userData = await signInUser(request, response, email);

    response.redirect(userData.newVisit ? "/?counted=1" : "/");
  } catch (e) {
    console.error("Magic Link Verify Error:", e);
    response.redirect("/?error=invalid-code");
  }
});

// --------------------------------------------------
// CURRENT USER STATUS
// --------------------------------------------------
router.get("/api/me", async (request, response) => {
  try {
    const user = await getUserFromRequest(request);

    if (!user) {
      response.clearCookie(COOKIE_NAME, { path: "/" });
      return response.status(401).json({
        error: "Not signed in.",
        offers: buildOffers(0, new Map(), await getOffers()).offers
      });
    }

    response.json(await getStatus(user.id));
  } catch (e) {
    console.log(`Me Error: ${e.message}`);
    response.status(500).json({
      error: "Something went wrong. Try again."
    });
  }
});

// --------------------------------------------------
// CLAIM REWARD
// --------------------------------------------------
router.post("/api/claim", async (request, response) => {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return response.status(401).json({
        error: "Please sign in first."
      });
    }

    const minVisits = Number(request.body?.minVisits);
    const offerList = await getOffers();
    const offer = offerList.find((item) => Number(item.minVisits) === minVisits);

    if (!offer) {
      return response.status(400).json({
        error: "Unknown reward."
      });
    }

    if (Number(user.visitCount) < offer.minVisits) {
      return response.status(400).json({
        error: "This reward is not unlocked yet."
      });
    }

    const result = await queries.createClaim(user.id, offer.minVisits, new Date());

    response.json({
      ...(await getStatus(user.id)),
      justClaimed: result.affectedRows === 1
    });
  } catch (e) {
    console.log(`Claim Error: ${e.message}`);
    response.status(500).json({
      error: "Could not claim the reward. Try again."
    });
  }
});

// --------------------------------------------------
// LOGOUT
// --------------------------------------------------
router.post("/api/logout", async (request, response) => {
  const token = getCookie(request, COOKIE_NAME);
  try {
    if (token) {
      await queries.deleteSession(hashToken(token));
    }
  } catch (e) {
    console.log(`Logout Error: ${e.message}`);
  }

  response.clearCookie(COOKIE_NAME, { path: "/" });
  response.json({ ok: true });
});

module.exports = router;


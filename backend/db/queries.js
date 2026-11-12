const { query, execute } = require("./config");

// ==================================================
// USERS QUERIES
// ==================================================

async function findUserByEmail(email) {
  const rows = await query(
    `SELECT * FROM users WHERE email = ? LIMIT 1`,
    [email]
  );
  return rows[0] || null;
}

async function findUserById(id) {
  const rows = await query(
    `SELECT * FROM users WHERE id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function createUser(email) {
  return await execute(
    `INSERT INTO users (email, createdAt, visitCount, lastVisitAt) VALUES (?, ?, 0, NULL)`,
    [email, new Date()]
  );
}

async function incrementUserVisits(userId, now, cutoff) {
  return await execute(
    `UPDATE users
     SET visitCount = visitCount + 1, lastVisitAt = ?
     WHERE id = ? AND (lastVisitAt IS NULL OR lastVisitAt <= ?)`,
    [now, userId, cutoff]
  );
}

// ==================================================
// SESSIONS QUERIES
// ==================================================

async function createSession(tokenHash, userId, createdAt = new Date()) {
  return await execute(
    `INSERT INTO sessions (tokenHash, userId, createdAt) VALUES (?, ?, ?)`,
    [tokenHash, userId, createdAt]
  );
}

async function findUserBySession(tokenHash) {
  const rows = await query(
    `SELECT u.id, u.email, u.createdAt, u.visitCount, u.lastVisitAt
     FROM sessions s
     INNER JOIN users u ON u.id = s.userId
     WHERE s.tokenHash = ?
     LIMIT 1`,
    [tokenHash]
  );
  return rows[0] || null;
}

async function deleteSession(tokenHash) {
  return await execute(
    `DELETE FROM sessions WHERE tokenHash = ?`,
    [tokenHash]
  );
}

// ==================================================
// VISITS LOG QUERIES
// ==================================================

async function insertVisit(userId, now = new Date()) {
  return await execute(
    `INSERT INTO visits (userId, at) VALUES (?, ?)`,
    [userId, now]
  );
}

async function getUserVisits(userId, limit = 2000) {
  return await query(
    `SELECT at FROM visits WHERE userId = ? ORDER BY at ASC LIMIT ?`,
    [userId, Number(limit)]
  );
}

// ==================================================
// CLAIMS QUERIES
// ==================================================

async function getUserClaims(userId) {
  return await query(
    `SELECT minVisits, claimedAt FROM claims WHERE userId = ?`,
    [userId]
  );
}

async function createClaim(userId, minVisits, claimedAt = new Date()) {
  return await execute(
    `INSERT IGNORE INTO claims (userId, minVisits, claimedAt) VALUES (?, ?, ?)`,
    [userId, minVisits, claimedAt]
  );
}

async function getClaimCountsByUser() {
  const rows = await query(`
    SELECT userId, COUNT(*) AS n
    FROM claims
    GROUP BY userId
  `);
  return new Map(rows.map((r) => [String(r.userId), Number(r.n)]));
}

async function getCustomerClaims(userId) {
  return await query(
    `SELECT minVisits, claimedAt FROM claims WHERE userId = ? ORDER BY claimedAt ASC`,
    [userId]
  );
}

async function getRecentClaims(limit = 20) {
  return await query(`
    SELECT c.id, c.userId, c.minVisits, c.claimedAt, u.email
    FROM claims c
    LEFT JOIN users u ON u.id = c.userId
    ORDER BY c.claimedAt DESC
    LIMIT ?
  `, [Number(limit)]);
}

// ==================================================
// SETTINGS QUERIES
// ==================================================

async function getSetting(key) {
  const rows = await query(
    `SELECT settingValue FROM settings WHERE settingKey = ? LIMIT 1`,
    [key]
  );
  if (!rows.length) return null;
  try {
    return JSON.parse(rows[0].settingValue);
  } catch {
    return rows[0].settingValue;
  }
}

async function saveSetting(key, value) {
  const json = JSON.stringify(value);
  return await execute(
    `INSERT INTO settings (settingKey, settingValue)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE
       settingValue = VALUES(settingValue),
       updatedAt = CURRENT_TIMESTAMP`,
    [key, json]
  );
}

async function deleteSetting(key) {
  return await execute(
    `DELETE FROM settings WHERE settingKey = ?`,
    [key]
  );
}

// ==================================================
// REVIEWS QUERIES
// ==================================================

async function upsertReview({ id, author, authorUrl, stars, text, publishedAt, now = new Date() }) {
  return await execute(
    `INSERT INTO reviews
       (id, author, authorUrl, stars, text, publishedAt, syncedAt, firstSeenAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       author = VALUES(author),
       authorUrl = VALUES(authorUrl),
       stars = VALUES(stars),
       text = VALUES(text),
       publishedAt = VALUES(publishedAt),
       syncedAt = VALUES(syncedAt)`,
    [id, author, authorUrl, stars, text, publishedAt, now, now]
  );
}

async function getReviews(limit = 50) {
  return await query(
    `SELECT author, stars, text, publishedAt
     FROM reviews
     ORDER BY publishedAt DESC
     LIMIT ?`,
    [Number(limit)]
  );
}

// ==================================================
// EMAIL OTPS (SMTP AUTH) QUERIES
// ==================================================

async function deleteOtpByEmail(email) {
  return await execute(
    `DELETE FROM email_otps WHERE email = ?`,
    [email]
  );
}

async function deleteExpiredOtps(now = Date.now()) {
  return await execute(
    `DELETE FROM email_otps WHERE expiresAt < ?`,
    [now]
  );
}

async function insertOtp(email, codeHash, expiresAt) {
  return await execute(
    `INSERT INTO email_otps (email, codeHash, expiresAt) VALUES (?, ?, ?)`,
    [email, codeHash, expiresAt]
  );
}

async function findLatestOtp(email, codeHash) {
  const rows = await query(
    `SELECT id, expiresAt FROM email_otps
     WHERE email = ? AND codeHash = ?
     ORDER BY id DESC LIMIT 1`,
    [email, codeHash]
  );
  return rows[0] || null;
}

// ==================================================
// DASHBOARD STATS QUERIES
// ==================================================

async function getDashboardSummary(todayStart, sevenDaysAgo) {
  const [
    customersRows,
    visitsRows,
    newTodayRows,
    visitedTodayRows,
    visited7DaysRows,
    claimedRows,
    claimedTodayRows
  ] = await Promise.all([
    query(`SELECT COUNT(*) AS n FROM users`),
    query(`SELECT COALESCE(SUM(visitCount), 0) AS total FROM users`),
    query(`SELECT COUNT(*) AS n FROM users WHERE createdAt >= ?`, [todayStart]),
    query(`SELECT COUNT(*) AS n FROM users WHERE lastVisitAt >= ?`, [todayStart]),
    query(`SELECT COUNT(*) AS n FROM users WHERE lastVisitAt >= ?`, [sevenDaysAgo]),
    query(`SELECT COUNT(*) AS n FROM claims`),
    query(`SELECT COUNT(*) AS n FROM claims WHERE claimedAt >= ?`, [todayStart])
  ]);

  return {
    customers: Number(customersRows[0]?.n || 0),
    totalVisits: Number(visitsRows[0]?.total || 0),
    newToday: Number(newTodayRows[0]?.n || 0),
    visitedToday: Number(visitedTodayRows[0]?.n || 0),
    visited7Days: Number(visited7DaysRows[0]?.n || 0),
    claimed: Number(claimedRows[0]?.n || 0),
    claimedToday: Number(claimedTodayRows[0]?.n || 0)
  };
}

async function getOfferStats(minVisits) {
  const [unlockedRows, claimedRows] = await Promise.all([
    query(`SELECT COUNT(*) AS n FROM users WHERE visitCount >= ?`, [minVisits]),
    query(`SELECT COUNT(*) AS n FROM claims WHERE minVisits = ?`, [minVisits])
  ]);

  return {
    unlocked: Number(unlockedRows[0]?.n || 0),
    claimed: Number(claimedRows[0]?.n || 0)
  };
}

async function getCustomerList(limit = 1000) {
  return await query(`
    SELECT id, email, visitCount, createdAt, lastVisitAt
    FROM users
    ORDER BY visitCount DESC, lastVisitAt DESC
    LIMIT ?
  `, [Number(limit)]);
}

async function getExportCustomers() {
  return await query(`
    SELECT email, visitCount, lastVisitAt, createdAt, id
    FROM users
    ORDER BY visitCount DESC, lastVisitAt DESC
  `);
}

module.exports = {
  findUserByEmail,
  findUserById,
  createUser,
  incrementUserVisits,
  createSession,
  findUserBySession,
  deleteSession,
  insertVisit,
  getUserVisits,
  getUserClaims,
  createClaim,
  getClaimCountsByUser,
  getCustomerClaims,
  getRecentClaims,
  getSetting,
  saveSetting,
  deleteSetting,
  upsertReview,
  getReviews,
  deleteOtpByEmail,
  deleteExpiredOtps,
  insertOtp,
  findLatestOtp,
  getDashboardSummary,
  getOfferStats,
  getCustomerList,
  getExportCustomers
};


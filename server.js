const express = require("express");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const QRCode = require("qrcode");
const mysql = require("mysql2/promise");
const { OAuth2Client } = require("google-auth-library");

// --------------------------------------------------
// LOAD .ENV
// --------------------------------------------------

const envPath = path.join(__dirname, ".env");

if (fs.existsSync(envPath)) {
  try {
    const content = fs.readFileSync(envPath, "utf-8");

    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#")) continue;

      const eqIdx = trimmed.indexOf("=");

      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();

        const val = trimmed
          .slice(eqIdx + 1)
          .trim()
          .replace(/^['"](.*)['"]$/, "$1");

        // Always override process.env with values from .env file
        process.env[key] = val;
      }
    }
  } catch (err) {
    console.error("Warning: Could not load .env file:", err.message);
  }
}

// --------------------------------------------------
// APP
// --------------------------------------------------

const app = express();

const PORT = Number(process.env.PORT || 3000);

const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID
);

// --------------------------------------------------
// SETTINGS
// --------------------------------------------------

const VISIT_COOLDOWN_MINUTES = Number(
  process.env.VISIT_COOLDOWN_MINUTES ?? 0
);

const COOKIE_NAME = "mart_session";

const ONE_YEAR_MS =
  365 * 24 * 60 * 60 * 1000;

const EMAIL_PATTERN =
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// --------------------------------------------------
// URL HELPERS
// --------------------------------------------------

const safeUrl = (value) => {
  const text = String(value || "").trim();

  return /^https:\/\//i.test(text)
    ? text
    : "";
};

const GOOGLE_REVIEW_URL =
  safeUrl(process.env.GOOGLE_REVIEW_URL);

const INSTAGRAM_URL =
  safeUrl(process.env.INSTAGRAM_URL);

const FACEBOOK_URL =
  safeUrl(process.env.FACEBOOK_URL);

// --------------------------------------------------
// GOOGLE REVIEWS
// --------------------------------------------------

const GOOGLE_PLACES_API_KEY =
  (process.env.GOOGLE_PLACES_API_KEY || "").trim();

const GOOGLE_PLACE_ID =
  (process.env.GOOGLE_PLACE_ID || "").trim();

const REVIEWS_REFRESH_MS =
  Number(
    process.env.GOOGLE_REVIEWS_REFRESH_HOURS ?? 6
  ) *
  60 *
  60 *
  1000;

const STORE_REVIEW_TEXT =
  (process.env.GOOGLE_STORE_REVIEW_TEXT ?? "true") !==
  "false";

// --------------------------------------------------
// DEFAULT OFFERS
// --------------------------------------------------

const DEFAULT_OFFERS = [
  {
    minVisits: 1,
    icon: "🎟️",
    headline: "Get 5% OFF",
    text: "Welcome offer: 5% off your bill today."
  },
  {
    minVisits: 3,
    icon: "🪙",
    headline: "Get 10% OFF",
    text: "Regular customer: 10% off your bill today."
  },
  {
    minVisits: 5,
    icon: "🎁",
    headline: "Get A Free Gift",
    text: "Loyal customer: collect a free gift at the counter."
  },
  {
    minVisits: 10,
    icon: "👑",
    headline: "Get 15% OFF",
    text: "VIP customer: 15% off every bill this month."
  }
];

// --------------------------------------------------
// DATABASE (XAMPP MySQL / MariaDB)
// --------------------------------------------------

function getDbConfig() {
  if (process.env.DATABASE_URL) {
    try {
      const parsed = new URL(process.env.DATABASE_URL);
      return {
        host: parsed.hostname || "localhost",
        port: parsed.port ? Number(parsed.port) : 3306,
        user: decodeURIComponent(parsed.username || "root"),
        password: decodeURIComponent(parsed.password || ""),
        database: parsed.pathname ? parsed.pathname.replace(/^\//, "") : "mart_loyalty"
      };
    } catch {
      // ignore parse failure and fall through
    }
  }

  return {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : "",
    database: process.env.DB_NAME || "mart_loyalty"
  };
}

let pool = null;

const databaseReady = initializeDatabase();

async function initializeDatabase() {
  const config = getDbConfig();

  // Step 1: Ensure target database exists in XAMPP MySQL
  try {
    const bootstrapConnection = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      charset: "utf8mb4"
    });

    try {
      await bootstrapConnection.query(
        `CREATE DATABASE IF NOT EXISTS \`${config.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
      );
    } finally {
      await bootstrapConnection.end();
    }
  } catch (err) {
    if (err.code === "ECONNREFUSED" || err.code === "EACCES" || err.code === "ENOTFOUND") {
      console.error("\n❌ Could not connect to MySQL server at " + config.host + ":" + config.port);
      console.error("👉 Please ensure XAMPP is running and MySQL service is started in XAMPP Control Panel.\n");
      throw err;
    } else {
      console.warn("Database pre-check notice:", err.message);
    }
  }

  // Step 2: Create connection pool with database selected
  pool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: "Z",
    charset: "utf8mb4"
  });

  const connection = await pool.getConnection();

  try {
    await connection.ping();

    console.log(`MySQL connection successful (Database: ${config.database}).`);

    // ------------------------------------------------
    // USERS
    // ------------------------------------------------

    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        email VARCHAR(254) NOT NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        visitCount INT NOT NULL DEFAULT 0,
        lastVisitAt DATETIME NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_users_email (email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // ------------------------------------------------
    // SESSIONS
    // ------------------------------------------------

    await connection.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        tokenHash CHAR(64) NOT NULL,
        userId BIGINT UNSIGNED NOT NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_sessions_tokenHash (tokenHash),
        KEY idx_sessions_userId (userId)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // ------------------------------------------------
    // CLAIMS
    // ------------------------------------------------

    await connection.query(`
      CREATE TABLE IF NOT EXISTS claims (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        userId BIGINT UNSIGNED NOT NULL,
        minVisits INT NOT NULL,
        claimedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_claim_user_reward (userId, minVisits),
        KEY idx_claims_userId (userId),
        KEY idx_claims_claimedAt (claimedAt)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // ------------------------------------------------
    // SETTINGS
    // ------------------------------------------------

    await connection.query(`
      CREATE TABLE IF NOT EXISTS settings (
        settingKey VARCHAR(100) NOT NULL,
        settingValue LONGTEXT NULL,
        updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (settingKey)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // ------------------------------------------------
    // VISITS
    // ------------------------------------------------

    await connection.query(`
      CREATE TABLE IF NOT EXISTS visits (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        userId BIGINT UNSIGNED NOT NULL,
        at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_visits_userId (userId),
        KEY idx_visits_at (at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // ------------------------------------------------
    // REVIEWS
    // ------------------------------------------------

    await connection.query(`
      CREATE TABLE IF NOT EXISTS reviews (
        id VARCHAR(255) NOT NULL,
        author VARCHAR(255) NOT NULL,
        authorUrl TEXT NULL,
        stars DECIMAL(3,1) NULL,
        text TEXT NULL,
        publishedAt DATETIME NULL,
        syncedAt DATETIME NULL,
        firstSeenAt DATETIME NULL,
        PRIMARY KEY (id),
        KEY idx_reviews_publishedAt (publishedAt)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // ------------------------------------------------
    // AUTO-MIGRATE LEGACY / EXISTING COLUMNS
    // ------------------------------------------------

    const migrateColumn = async (table, oldCol, newCol, colDef) => {
      try {
        const [oldExists] = await connection.query(`
          SELECT COLUMN_NAME
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = ?
            AND COLUMN_NAME = ?
        `, [table, oldCol]);

        if (oldExists.length > 0) {
          const [newExists] = await connection.query(`
            SELECT COLUMN_NAME
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = ?
              AND COLUMN_NAME = ?
          `, [table, newCol]);

          if (newExists.length === 0) {
            await connection.query(
              `ALTER TABLE \`${table}\` CHANGE COLUMN \`${oldCol}\` \`${newCol}\` ${colDef}`
            );
            console.log(`Auto-migrated column: ${table}.${oldCol} -> ${table}.${newCol}`);
          }
        }
      } catch (e) {
        console.warn(`Migration notice for ${table}.${oldCol}:`, e.message);
      }
    };

    const ensureColumn = async (table, colName, colDef) => {
      try {
        const [exists] = await connection.query(`
          SELECT COLUMN_NAME
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = ?
            AND COLUMN_NAME = ?
        `, [table, colName]);

        if (exists.length === 0) {
          await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${colName}\` ${colDef}`);
          console.log(`Auto-added column: ${table}.${colName}`);
        }
      } catch (e) {
        console.warn(`Column check notice for ${table}.${colName}:`, e.message);
      }
    };

    // 1. Users table (created_at -> createdAt, visit_count -> visitCount, last_visit_at -> lastVisitAt)
    await migrateColumn("users", "created_at", "createdAt", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP");
    await migrateColumn("users", "visit_count", "visitCount", "INT NOT NULL DEFAULT 0");
    await migrateColumn("users", "last_visit_at", "lastVisitAt", "DATETIME NULL");
    await ensureColumn("users", "createdAt", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP");
    await ensureColumn("users", "visitCount", "INT NOT NULL DEFAULT 0");
    await ensureColumn("users", "lastVisitAt", "DATETIME NULL");

    // 2. Settings table (name -> settingKey, value -> settingValue, updated_at -> updatedAt)
    await migrateColumn("settings", "name", "settingKey", "VARCHAR(100) NOT NULL");
    await migrateColumn("settings", "value", "settingValue", "LONGTEXT NULL");
    await migrateColumn("settings", "updated_at", "updatedAt", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");
    await ensureColumn("settings", "settingKey", "VARCHAR(100) NOT NULL");
    await ensureColumn("settings", "settingValue", "LONGTEXT NULL");
    await ensureColumn("settings", "updatedAt", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");

    // 3. Sessions table (token_hash -> tokenHash, user_id -> userId, created_at -> createdAt)
    await migrateColumn("sessions", "token_hash", "tokenHash", "CHAR(64) NOT NULL");
    await migrateColumn("sessions", "user_id", "userId", "BIGINT UNSIGNED NOT NULL");
    await migrateColumn("sessions", "created_at", "createdAt", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP");
    await ensureColumn("sessions", "tokenHash", "CHAR(64) NOT NULL");
    await ensureColumn("sessions", "userId", "BIGINT UNSIGNED NOT NULL");

    // 4. Claims table (user_id -> userId, min_visits -> minVisits, claimed_at -> claimedAt)
    await migrateColumn("claims", "user_id", "userId", "BIGINT UNSIGNED NOT NULL");
    await migrateColumn("claims", "min_visits", "minVisits", "INT NOT NULL");
    await migrateColumn("claims", "claimed_at", "claimedAt", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP");
    await ensureColumn("claims", "userId", "BIGINT UNSIGNED NOT NULL");
    await ensureColumn("claims", "minVisits", "INT NOT NULL");
    await ensureColumn("claims", "claimedAt", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP");

    // 5. Visits table (user_id -> userId, visited_at -> at)
    await migrateColumn("visits", "user_id", "userId", "BIGINT UNSIGNED NOT NULL");
    await migrateColumn("visits", "visited_at", "at", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP");
    await ensureColumn("visits", "userId", "BIGINT UNSIGNED NOT NULL");
    await ensureColumn("visits", "at", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP");

    // 6. Reviews table (author_url -> authorUrl, review_text -> text, etc.)
    await migrateColumn("reviews", "author_url", "authorUrl", "TEXT NULL");
    await migrateColumn("reviews", "review_text", "text", "TEXT NULL");
    await migrateColumn("reviews", "published_at", "publishedAt", "DATETIME NULL");
    await migrateColumn("reviews", "first_seen_at", "firstSeenAt", "DATETIME NULL");
    await migrateColumn("reviews", "synced_at", "syncedAt", "DATETIME NULL");
    await ensureColumn("reviews", "text", "TEXT NULL");
  } finally {
    connection.release();
  }
}

app.locals.databaseReady = databaseReady;

databaseReady.catch(() => { });

// --------------------------------------------------
// GENERIC DB HELPERS
// --------------------------------------------------

async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function execute(sql, params = []) {
  const [result] = await pool.query(sql, params);
  return result;
}

// --------------------------------------------------
// OFFERS
// --------------------------------------------------

function buildOffers(
  visits,
  claims = new Map(),
  offerList = DEFAULT_OFFERS
) {
  const offers = offerList.map((offer) => {
    const unlocked = visits >= offer.minVisits;

    const claimedAt =
      claims.get(offer.minVisits) || null;

    const status = claimedAt
      ? "claimed"
      : unlocked
        ? "available"
        : "locked";

    return {
      ...offer,
      unlocked,
      claimedAt,
      status
    };
  });

  const currentIndex = offers.reduce(
    (last, offer, index) =>
      offer.unlocked ? index : last,
    -1
  );

  const nextOffer = offerList.find(
    (offer) => visits < offer.minVisits
  );

  const next = nextOffer
    ? {
      headline: nextOffer.headline,
      visitsAway:
        nextOffer.minVisits - visits
    }
    : null;

  return {
    offers,
    currentIndex,
    next
  };
}

// --------------------------------------------------
// DATE
// --------------------------------------------------

const toIso = (value) => {
  if (!value) return null;

  return new Date(value).toISOString();
};

// --------------------------------------------------
// NETWORK HELPERS
// --------------------------------------------------

const getLanAddresses = () => {
  const found = [];

  for (const [name, list] of Object.entries(
    os.networkInterfaces()
  )) {
    for (const i of list || []) {
      const isV4 =
        i.family === "IPv4" ||
        i.family === 4;

      if (
        isV4 &&
        !i.internal &&
        !i.address.startsWith("169.254.")
      ) {
        found.push({
          name,
          address: i.address
        });
      }
    }
  }

  return found;
};

const scoreAddress = ({
  name,
  address
}) => {
  const n = name.toLowerCase();

  let score = 0;

  if (/wi-?fi|wlan|wireless/.test(n)) {
    score += 3;
  }

  if (
    /vethernet|vmware|virtualbox|wsl|hyper-v|docker|vpn|tap|tun/.test(
      n
    )
  ) {
    score -= 5;
  }

  if (address.startsWith("192.168.")) {
    score += 2;
  } else if (address.startsWith("10.")) {
    score += 1;
  }

  return score;
};

const normalizeUrl = (value) => {
  const trimmed = value
    .trim()
    .replace(/\/+$/, "");

  return /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
};

const getPublicUrl = () =>
  process.env.SITE_URL?.trim() ||
  process.env.PUBLIC_URL?.trim() ||
  process.env.RENDER_EXTERNAL_URL?.trim() ||
  process.env.VERCEL_URL?.trim() ||
  "";

const getBaseUrl = () => {
  const publicUrl = getPublicUrl();

  if (publicUrl) {
    return normalizeUrl(publicUrl);
  }

  const best = getLanAddresses()
    .sort(
      (a, b) =>
        scoreAddress(b) -
        scoreAddress(a)
    )[0];

  return `http://${best ? best.address : "localhost"}:${PORT}`;
};

const getScanUrl = () =>
  `${getBaseUrl()}/scan`;

// --------------------------------------------------
// SETTINGS HELPERS
// --------------------------------------------------

async function getSetting(key) {
  const rows = await query(
    `
      SELECT settingValue
      FROM settings
      WHERE settingKey = ?
      LIMIT 1
    `,
    [key]
  );

  if (!rows.length) {
    return null;
  }

  try {
    return JSON.parse(rows[0].settingValue);
  } catch {
    return rows[0].settingValue;
  }
}

async function saveSetting(key, value) {
  const json = JSON.stringify(value);

  await execute(
    `
      INSERT INTO settings
        (settingKey, settingValue)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE
        settingValue = VALUES(settingValue),
        updatedAt = CURRENT_TIMESTAMP
    `,
    [key, json]
  );
}

async function deleteSetting(key) {
  await execute(
    `
      DELETE FROM settings
      WHERE settingKey = ?
    `,
    [key]
  );
}

// --------------------------------------------------
// GOOGLE REVIEWS
// --------------------------------------------------

let reviewSync = null;
let reviewFailedAt = 0;

const syncGoogleReviews = async (force = false) => {
  if (
    !GOOGLE_PLACES_API_KEY ||
    !GOOGLE_PLACE_ID
  ) {
    return null;
  }

  const saved = await getSetting(
    "googleSummary"
  );

  if (
    !force &&
    saved?.fetchedAt &&
    Date.now() -
    new Date(saved.fetchedAt).getTime() <
    REVIEWS_REFRESH_MS
  ) {
    return saved;
  }

  if (
    !force &&
    Date.now() - reviewFailedAt <
    10 * 60 * 1000
  ) {
    return saved;
  }

  if (reviewSync) {
    return reviewSync;
  }

  reviewSync = (async () => {
    try {
      const res = await fetch(
        `https://places.googleapis.com/v1/places/${encodeURIComponent(
          GOOGLE_PLACE_ID
        )}`,
        {
          headers: {
            "X-Goog-Api-Key":
              GOOGLE_PLACES_API_KEY,
            "X-Goog-FieldMask":
              "rating,userRatingCount,reviews"
          }
        }
      );

      if (!res.ok) {
        throw new Error(
          `Places API ${res.status}`
        );
      }

      const place = await res.json();

      const now = new Date();

      console.log(
        `Google Reviews Sync: rating ${place.rating}, ${place.userRatingCount} ratings, ${(place.reviews || []).length} reviews returned`
      );

      for (const r of place.reviews || []) {
        if (!r.name) continue;

        const author =
          r.authorAttribution
            ?.displayName ||
          "Google user";

        const authorUrl =
          r.authorAttribution?.uri ||
          null;

        const stars =
          r.rating ?? null;

        const publishedAt =
          r.publishTime
            ? new Date(r.publishTime)
            : null;

        const text =
          STORE_REVIEW_TEXT
            ? r.text?.text ||
            r.originalText?.text ||
            ""
            : "";

        await execute(
          `
            INSERT INTO reviews
              (
                id,
                author,
                authorUrl,
                stars,
                text,
                publishedAt,
                syncedAt,
                firstSeenAt
              )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              author = VALUES(author),
              authorUrl = VALUES(authorUrl),
              stars = VALUES(stars),
              text = VALUES(text),
              publishedAt = VALUES(publishedAt),
              syncedAt = VALUES(syncedAt)
          `,
          [
            r.name,
            author,
            authorUrl,
            stars,
            text,
            publishedAt,
            now,
            now
          ]
        );
      }

      const summary = {
        rating:
          place.rating ?? null,
        count:
          place.userRatingCount ?? 0,
        fetchedAt: now
      };

      await saveSetting(
        "googleSummary",
        summary
      );

      return summary;
    } catch (e) {
      reviewFailedAt = Date.now();

      console.log(
        `Google Reviews Sync Error: ${e.message}`
      );

      return saved;
    } finally {
      reviewSync = null;
    }
  })();

  return reviewSync;
};

// --------------------------------------------------
// OFFERS
// --------------------------------------------------

const getOffers = async () => {
  const doc = await getSetting("offers");

  if (
    Array.isArray(doc) &&
    doc.length > 0
  ) {
    return doc;
  }

  return DEFAULT_OFFERS;
};

// --------------------------------------------------
// LINKS
// --------------------------------------------------

const getLinks = async () => {
  const doc = await getSetting("links");

  const pick = (
    key,
    fallback
  ) => {
    return typeof doc?.[key] === "string"
      ? doc[key]
      : fallback;
  };

  return {
    googleReviewUrl: safeUrl(
      pick(
        "googleReviewUrl",
        GOOGLE_REVIEW_URL
      )
    ),

    instagramUrl: safeUrl(
      pick(
        "instagramUrl",
        INSTAGRAM_URL
      )
    ),

    facebookUrl: safeUrl(
      pick(
        "facebookUrl",
        FACEBOOK_URL
      )
    )
  };
};

// --------------------------------------------------
// SESSION HELPERS
// --------------------------------------------------

const hashToken = (token) =>
  crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");

const getCookie = (
  request,
  name
) => {
  const header =
    request.headers.cookie || "";

  for (const part of header.split(";")) {
    const [key, ...rest] =
      part.trim().split("=");

    if (key === name) {
      return decodeURIComponent(
        rest.join("=")
      );
    }
  }

  return null;
};

const getUserFromRequest = async (
  request
) => {
  const token = getCookie(
    request,
    COOKIE_NAME
  );

  if (!token) {
    return null;
  }

  const rows = await query(
    `
      SELECT
        u.id,
        u.email,
        u.createdAt,
        u.visitCount,
        u.lastVisitAt
      FROM sessions s
      INNER JOIN users u
        ON u.id = s.userId
      WHERE s.tokenHash = ?
      LIMIT 1
    `,
    [hashToken(token)]
  );

  return rows[0] || null;
};

// --------------------------------------------------
// ADD VISIT
// --------------------------------------------------

const addVisit = async (
  userId
) => {
  const now = new Date();

  const cutoff = new Date(
    now.getTime() -
    VISIT_COOLDOWN_MINUTES *
    60 *
    1000
  );

  const result = await execute(
    `
      UPDATE users
      SET
        visitCount = visitCount + 1,
        lastVisitAt = ?
      WHERE id = ?
        AND (
          lastVisitAt IS NULL
          OR lastVisitAt <= ?
        )
    `,
    [
      now,
      userId,
      cutoff
    ]
  );

  const counted =
    result.affectedRows === 1;

  if (counted) {
    try {
      await execute(
        `
          INSERT INTO visits
            (userId, at)
          VALUES (?, ?)
        `,
        [userId, now]
      );
    } catch (e) {
      console.log(
        `Visit Log Error: ${e.message}`
      );
    }
  }

  return counted;
};

// --------------------------------------------------
// STATUS
// --------------------------------------------------

const getStatus = async (
  userId
) => {
  const users = await query(
    `
      SELECT
        id,
        email,
        visitCount
      FROM users
      WHERE id = ?
      LIMIT 1
    `,
    [userId]
  );

  if (!users.length) {
    throw new Error(
      "User not found."
    );
  }

  const user = users[0];

  const offerList =
    await getOffers();

  const rows = await query(
    `
      SELECT
        minVisits,
        claimedAt
      FROM claims
      WHERE userId = ?
    `,
    [userId]
  );

  const claims = new Map(
    rows.map((row) => [
      Number(row.minVisits),
      toIso(row.claimedAt)
    ])
  );

  return {
    ok: true,
    email: user.email,
    visits: Number(
      user.visitCount
    ),
    ...buildOffers(
      Number(user.visitCount),
      claims,
      offerList
    )
  };
};

// --------------------------------------------------
// SIGN IN
// --------------------------------------------------

const signInUser = async (
  request,
  response,
  email
) => {
  let users = await query(
    `
      SELECT *
      FROM users
      WHERE email = ?
      LIMIT 1
    `,
    [email]
  );

  let user;

  if (users.length) {
    user = users[0];
  } else {
    const result = await execute(
      `
        INSERT INTO users
          (
            email,
            createdAt,
            visitCount,
            lastVisitAt
          )
        VALUES (?, ?, 0, NULL)
      `,
      [email, new Date()]
    );

    users = await query(
      `
        SELECT *
        FROM users
        WHERE id = ?
        LIMIT 1
      `,
      [result.insertId]
    );

    user = users[0];
  }

  const token =
    crypto.randomBytes(32).toString(
      "hex"
    );

  await execute(
    `
      INSERT INTO sessions
        (
          tokenHash,
          userId,
          createdAt
        )
      VALUES (?, ?, ?)
    `,
    [
      hashToken(token),
      user.id,
      new Date()
    ]
  );

  response.cookie(
    COOKIE_NAME,
    token,
    {
      httpOnly: true,
      sameSite: "lax",
      secure: request.secure,
      maxAge: ONE_YEAR_MS
    }
  );

  const counted =
    await addVisit(user.id);

  return {
    ...(await getStatus(user.id)),
    newVisit: counted
  };
};

// --------------------------------------------------
// MIDDLEWARE
// --------------------------------------------------

app.set("trust proxy", 1);

app.use(
  express.json({
    limit: "32kb"
  })
);

app.use(
  "/api",
  (request, response, next) => {
    response.set(
      "Cache-Control",
      "no-store"
    );

    next();
  }
);

// --------------------------------------------------
// HEALTH
// --------------------------------------------------

app.get(
  "/health",
  async (request, response) => {
    try {
      await databaseReady;

      await query(
        "SELECT 1"
      );

      response
        .type("text")
        .send("OK");
    } catch (e) {
      response
        .status(500)
        .type("text")
        .send("Database error");
    }
  }
);

// --------------------------------------------------
// CONFIG
// --------------------------------------------------

app.get(
  "/api/config",
  async (
    request,
    response
  ) => {
    let rating =
      (
        process.env.GOOGLE_RATING ||
        ""
      ).trim();

    let count = null;

    let links = {
      googleReviewUrl:
        GOOGLE_REVIEW_URL,
      instagramUrl:
        INSTAGRAM_URL,
      facebookUrl:
        FACEBOOK_URL
    };

    try {
      await databaseReady;

      links =
        await getLinks();

      const summary =
        await syncGoogleReviews();

      if (
        typeof summary?.rating ===
        "number"
      ) {
        rating =
          summary.rating.toFixed(1);

        count =
          summary.count ?? null;
      }
    } catch (e) {
      console.log(
        `Config Error: ${e.message}`
      );
    }

    response.json({
      googleReviewUrl:
        links.googleReviewUrl ||
        null,

      instagramUrl:
        links.instagramUrl ||
        null,

      facebookUrl:
        links.facebookUrl ||
        null,

      googleRating:
        rating || null,

      googleReviewCount:
        count
    });
  }
);

// --------------------------------------------------
// WAIT FOR DATABASE
// --------------------------------------------------

app.use(
  async (
    request,
    response,
    next
  ) => {
    try {
      await databaseReady;
      next();
    } catch (e) {
      console.log(
        `DB Error: ${e.message}`
      );

      response
        .status(500)
        .json({
          error:
            "Database not available. Check the MySQL settings."
        });
    }
  }
);

// --------------------------------------------------
// REVIEWS
// --------------------------------------------------

app.get(
  "/api/reviews",
  async (
    request,
    response
  ) => {
    try {
      await syncGoogleReviews();

      const summaries =
        await getSetting(
          "googleSummary"
        );

      const rows =
        await query(
          `
            SELECT
              author,
              stars,
              text,
              publishedAt
            FROM reviews
            ORDER BY publishedAt DESC
            LIMIT 50
          `
        );

      response.json({
        rating:
          summaries?.rating ??
          null,

        count:
          summaries?.count ??
          0,

        updatedAt:
          summaries?.fetchedAt
            ? toIso(
              summaries.fetchedAt
            )
            : null,

        reviews:
          rows.map((r) => ({
            author: r.author,
            stars: r.stars,
            text: r.text || "",
            publishedAt:
              r.publishedAt
                ? toIso(
                  r.publishedAt
                )
                : null
          }))
      });
    } catch (e) {
      console.log(
        `Reviews Error: ${e.message}`
      );

      response
        .status(500)
        .json({
          error:
            "Could not load reviews."
        });
    }
  }
);

// --------------------------------------------------
// QR
// --------------------------------------------------

app.get(
  "/qr.png",
  async (
    request,
    response
  ) => {
    try {
      const png =
        await QRCode.toBuffer(
          getScanUrl(),
          {
            width: 600,
            margin: 2
          }
        );

      response
        .type("png")
        .send(png);
    } catch (e) {
      response
        .status(500)
        .send(
          "Could not create QR code"
        );
    }
  }
);

app.get(
  "/qr",
  (
    request,
    response
  ) => {
    response.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport"
          content="width=device-width, initial-scale=1">
        <title>Scan to open</title>
      </head>
      <body
        style="font-family:sans-serif;text-align:center;padding:2rem"
      >
        <h1>Scan to open</h1>

        <img
          src="/qr.png"
          alt="QR code"
          width="300"
          height="300"
        >

        <p>${getScanUrl()}</p>
      </body>
      </html>
    `);
  }
);

// --------------------------------------------------
// SCAN
// --------------------------------------------------

app.get(
  "/scan",
  async (
    request,
    response
  ) => {
    response.set(
      "Cache-Control",
      "no-store"
    );

    let counted = false;

    try {
      const user =
        await getUserFromRequest(
          request
        );

      if (user) {
        counted =
          await addVisit(
            user.id
          );
      }
    } catch (e) {
      console.log(
        `Scan Error: ${e.message}`
      );
    }

    response.redirect(
      counted
        ? "/?counted=1"
        : "/"
    );
  }
);

// --------------------------------------------------
// STATIC FILES
// --------------------------------------------------

app.use(
  express.static(
    path.join(
      __dirname,
      "public"
    )
  )
);

// --------------------------------------------------
// EMAIL LOGIN
// --------------------------------------------------

app.post(
  "/api/login",
  async (
    request,
    response
  ) => {
    const email =
      String(
        request.body?.email ?? ""
      )
        .trim()
        .toLowerCase();

    if (
      !email ||
      email.length > 254 ||
      !EMAIL_PATTERN.test(email)
    ) {
      return response
        .status(400)
        .json({
          error:
            "Enter a valid email address."
        });
    }

    try {
      response.json(
        await signInUser(
          request,
          response,
          email
        )
      );
    } catch (e) {
      console.log(
        `Login Error: ${e.message}`
      );

      response
        .status(500)
        .json({
          error:
            "Could not save your email. Try again."
        });
    }
  }
);

// --------------------------------------------------
// GOOGLE LOGIN
// --------------------------------------------------

app.post(
  "/api/google-login",
  async (
    request,
    response
  ) => {
    try {
      const credential =
        String(
          request.body?.credential ??
          ""
        );

      if (!credential) {
        return response
          .status(400)
          .json({
            error:
              "Missing Google sign-in."
          });
      }

      const ticket =
        await googleClient.verifyIdToken(
          {
            idToken:
              credential,
            audience:
              process.env
                .GOOGLE_CLIENT_ID
          }
        );

      const payload =
        ticket.getPayload();

      if (
        !payload?.email ||
        !payload.email_verified
      ) {
        return response
          .status(400)
          .json({
            error:
              "Your Google email is not verified."
          });
      }

      const email =
        payload.email
          .trim()
          .toLowerCase();

      response.json({
        ...(await signInUser(
          request,
          response,
          email
        )),

        name:
          payload.name
      });
    } catch (e) {
      console.error(
        `Google Login Error:`,
        e
      );

      response
        .status(401)
        .json({
          error:
            `Google sign-in failed: ${e.message || "Unknown error"}`
        });
    }
  }
);

// --------------------------------------------------
// CURRENT USER
// --------------------------------------------------

app.get(
  "/api/me",
  async (
    request,
    response
  ) => {
    try {
      const user =
        await getUserFromRequest(
          request
        );

      if (!user) {
        response.clearCookie(
          COOKIE_NAME
        );

        return response
          .status(401)
          .json({
            error:
              "Not signed in.",

            offers:
              buildOffers(
                0,
                new Map(),
                await getOffers()
              ).offers
          });
      }

      response.json(
        await getStatus(
          user.id
        )
      );
    } catch (e) {
      console.log(
        `Me Error: ${e.message}`
      );

      response
        .status(500)
        .json({
          error:
            "Something went wrong. Try again."
        });
    }
  }
);

// --------------------------------------------------
// CLAIM
// --------------------------------------------------

app.post(
  "/api/claim",
  async (
    request,
    response
  ) => {
    try {
      const user =
        await getUserFromRequest(
          request
        );

      if (!user) {
        return response
          .status(401)
          .json({
            error:
              "Please sign in first."
          });
      }

      const minVisits =
        Number(
          request.body?.minVisits
        );

      const offerList =
        await getOffers();

      const offer =
        offerList.find(
          (item) =>
            Number(
              item.minVisits
            ) === minVisits
        );

      if (!offer) {
        return response
          .status(400)
          .json({
            error:
              "Unknown reward."
          });
      }

      if (
        Number(user.visitCount) <
        offer.minVisits
      ) {
        return response
          .status(400)
          .json({
            error:
              "This reward is not unlocked yet."
          });
      }

      const result =
        await execute(
          `
            INSERT IGNORE INTO claims
              (
                userId,
                minVisits,
                claimedAt
              )
            VALUES (?, ?, ?)
          `,
          [
            user.id,
            offer.minVisits,
            new Date()
          ]
        );

      response.json({
        ...(await getStatus(
          user.id
        )),

        justClaimed:
          result.affectedRows === 1
      });
    } catch (e) {
      console.log(
        `Claim Error: ${e.message}`
      );

      response
        .status(500)
        .json({
          error:
            "Could not claim the reward. Try again."
        });
    }
  }
);

// --------------------------------------------------
// LOGOUT
// --------------------------------------------------

app.post(
  "/api/logout",
  async (
    request,
    response
  ) => {
    const token =
      getCookie(
        request,
        COOKIE_NAME
      );

    try {
      if (token) {
        await execute(
          `
            DELETE FROM sessions
            WHERE tokenHash = ?
          `,
          [hashToken(token)]
        );
      }
    } catch (e) {
      console.log(
        `Logout Error: ${e.message}`
      );
    }

    response.clearCookie(
      COOKIE_NAME
    );

    response.json({
      ok: true
    });
  }
);

// --------------------------------------------------
// DASHBOARD
// --------------------------------------------------

require("./dashboard")(
  app,
  {
    getDb: () => ({
      query,
      execute,
      pool
    }),

    getCookie,

    getOffers,

    defaultOffers:
      DEFAULT_OFFERS,

    toIso,

    syncGoogleReviews,

    getLinks
  }
);

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

if (require.main === module) {
  databaseReady
    .then(() => {
      const scanUrl =
        getScanUrl();

      const isPublic =
        Boolean(
          getPublicUrl()
        );

      const server =
        app.listen(
          PORT,
          "0.0.0.0",
          async () => {
            console.log(
              `Server Running at http://localhost:${PORT}/`
            );

            console.log(
              "Database: XAMPP MySQL / MariaDB"
            );

            console.log("");

            console.log(
              "Addresses on this computer:"
            );

            for (
              const address of
              getLanAddresses()
            ) {
              console.log(
                `  http://${address.address}:${PORT} (${address.name})`
              );
            }

            console.log("");

            try {
              console.log(
                await QRCode.toString(
                  scanUrl,
                  {
                    type: "terminal",
                    small: true
                  }
                )
              );
            } catch (error) {
              console.log(
                `Could not draw QR code: ${error.message}`
              );
            }

            console.log(
              `QR code points to: ${scanUrl}`
            );

            if (isPublic) {
              console.log(
                "A public URL is set, so this QR code works on mobile data too."
              );
            } else {
              console.log(
                "No public URL is set, so this QR code works only on the same Wi-Fi."
              );

              console.log(
                "For mobile data, run a tunnel and set PUBLIC_URL to its https link."
              );
            }

            console.log(
              `1) Test: ${getBaseUrl()}/health`
            );

            console.log(
              `2) QR: http://localhost:${PORT}/qr`
            );

            console.log(
              `3) Dashboard: http://localhost:${PORT}/dashboard`
            );
          }
        );

      server.on(
        "error",
        (error) => {
          console.error(
            `Server Error: ${error.message}`
          );

          process.exit(1);
        }
      );
    })
    .catch((error) => {
      console.error(
        `DB Error: ${error.message}`
      );

      process.exit(1);
    });
}

module.exports = app;
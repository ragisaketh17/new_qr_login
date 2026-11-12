async function runMigrations(connection) {
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
  // EMAIL OTPS (SMTP AUTH)
  // ------------------------------------------------
  try {
    const [otpCols] = await connection.query("SHOW COLUMNS FROM email_otps LIKE 'expiresAt'");
    if (otpCols.length && otpCols[0].Type.toLowerCase().includes("datetime")) {
      await connection.query("DROP TABLE email_otps");
    }
  } catch (_) { }

  await connection.query(`
    CREATE TABLE IF NOT EXISTS email_otps (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      email VARCHAR(254) NOT NULL,
      codeHash CHAR(64) NOT NULL,
      expiresAt BIGINT NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_email_otps_email (email),
      KEY idx_email_otps_expiresAt (expiresAt)
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
}

module.exports = { runMigrations };


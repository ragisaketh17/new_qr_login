const mysql = require("mysql2/promise");
const { runMigrations } = require("./migrate");

function getDbConfig() {
  const dbUrl =
    process.env.DATABASE_URL ||
    process.env.MYSQL_URL ||
    process.env.JAWSDB_URL ||
    process.env.CLEARDB_DATABASE_URL;

  if (dbUrl) {
    try {
      const parsed = new URL(dbUrl);
      const isRemote =
        parsed.hostname !== "localhost" &&
        parsed.hostname !== "127.0.0.1";

      const cleanDb = parsed.pathname
        ? parsed.pathname.replace(/^\/+/, "").split("?")[0].split("/")[0].trim()
        : "";

      return {
        host: parsed.hostname || "localhost",
        port: parsed.port ? Number(parsed.port) : 3306,
        user: decodeURIComponent(parsed.username || "root"),
        password: decodeURIComponent(parsed.password || ""),
        database: cleanDb || process.env.DB_NAME || "mart_loyalty",
        ssl: isRemote || process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined
      };
    } catch {
      // ignore parse failure and fall through
    }
  }

  const host =
    process.env.DB_HOST ||
    process.env.MYSQLHOST ||
    "localhost";

  const port = Number(
    process.env.DB_PORT ||
    process.env.MYSQLPORT ||
    3306
  );

  const user =
    process.env.DB_USER ||
    process.env.MYSQLUSER ||
    "root";

  const password =
    process.env.DB_PASSWORD !== undefined
      ? process.env.DB_PASSWORD
      : (process.env.MYSQLPASSWORD !== undefined
        ? process.env.MYSQLPASSWORD
        : "");

  const database =
    process.env.DB_NAME ||
    process.env.MYSQLDATABASE ||
    "mart_loyalty";

  const isRemote = host !== "localhost" && host !== "127.0.0.1";

  return {
    host,
    port,
    user,
    password,
    database,
    ssl: (isRemote || process.env.DB_SSL === "true") ? { rejectUnauthorized: false } : undefined
  };
}

let pool = null;

function getPool() {
  return pool;
}

async function query(sql, params = []) {
  if (!pool) {
    throw new Error("Database pool is not initialized yet.");
  }
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function execute(sql, params = []) {
  if (!pool) {
    throw new Error("Database pool is not initialized yet.");
  }
  const [result] = await pool.query(sql, params);
  return result;
}

async function tryInitializeDatabase() {
  const config = getDbConfig();
  const isLocal = config.host === "localhost" || config.host === "127.0.0.1";

  // Step 1: Ensure target database exists in local MySQL (local only)
  if (isLocal) {
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
        throw err;
      } else {
        console.warn("Database pre-check notice:", err.message);
      }
    }
  }

  // Step 2: Create connection pool with database selected
  const poolConfig = {
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: "Z",
    charset: "utf8mb4",
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
  };

  if (config.ssl) {
    poolConfig.ssl = config.ssl;
  }

  pool = mysql.createPool(poolConfig);

  const connection = await pool.getConnection();
  try {
    await connection.ping();
    console.log(`MySQL connection successful (Database: ${config.database}).`);
    await runMigrations(connection);
  } finally {
    connection.release();
  }

  return pool;
}

async function initializeDatabase(retries = 5, delay = 2500) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await tryInitializeDatabase();
    } catch (err) {
      if (pool) {
        try { await pool.end(); } catch (_) { }
        pool = null;
      }
      const config = getDbConfig();
      const isLocal = config.host === "localhost" || config.host === "127.0.0.1";
      if (isLocal && (err.code === "ECONNREFUSED" || err.code === "EACCES" || err.code === "ENOTFOUND")) {
        console.error("\n❌ Could not connect to MySQL server at " + config.host + ":" + config.port);
        console.error("👉 Please ensure XAMPP / MySQL service is running.\n");
        throw err;
      }
      if (attempt < retries) {
        console.warn(`⏳ MySQL connection attempt ${attempt}/${retries} failed (${err.message}). Retrying in ${delay / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        console.error(`\n❌ Failed to connect to MySQL after ${retries} attempts:`, err.message);
        throw err;
      }
    }
  }
}

module.exports = {
  getDbConfig,
  getPool,
  initializeDatabase,
  query,
  execute
};


const express = require("express");
const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");

// --------------------------------------------------
// LOAD .ENV
// --------------------------------------------------
const envCandidates = [
  path.join(__dirname, "..", ".env"),
  path.join(__dirname, ".env"),
  path.join(process.cwd(), ".env")
];

for (const envPath of envCandidates) {
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
          process.env[key] = val;
        }
      }
      break;
    } catch (err) {
      console.error("Warning: Could not load .env file:", err.message);
    }
  }
}

// --------------------------------------------------
// DATABASE INITIALIZATION
// --------------------------------------------------
const { initializeDatabase, query } = require("./db/config");
const {
  PORT,
  getLanAddresses,
  getScanUrl,
  getBaseUrl,
  getPublicUrl
} = require("./utils/helpers");

const databaseReady = initializeDatabase();
databaseReady.catch(() => { });

// --------------------------------------------------
// APP SETUP
// --------------------------------------------------
const app = express();
app.locals.databaseReady = databaseReady;

app.set("trust proxy", 1);
app.use(express.json({ limit: "32kb" }));

app.use("/api", (request, response, next) => {
  response.set("Cache-Control", "no-store");
  next();
});

app.use("/admin", (request, response, next) => {
  response.set("Cache-Control", "no-store");
  next();
});

// --------------------------------------------------
// STATIC FILES & FRONTEND
// --------------------------------------------------
const frontendDir = [
  path.join(__dirname, "..", "frontend"),
  path.join(__dirname, "frontend"),
  path.join(process.cwd(), "frontend"),
  path.join(__dirname, "..", "public"),
  path.join(__dirname, "public"),
  path.join(process.cwd(), "public")
].find((dir) => fs.existsSync(dir)) || path.join(__dirname, "..", "frontend");

app.use(express.static(frontendDir));

app.get("/", (request, response) => {
  const indexFile = path.join(frontendDir, "index.html");
  if (fs.existsSync(indexFile)) {
    return response.sendFile(indexFile);
  }
  response.status(404).send("Frontend index.html not found.");
});

// --------------------------------------------------
// ROUTES
// --------------------------------------------------
const configRoutes = require("./routes/config");
const authRoutes = require("./routes/auth");
const qrRoutes = require("./routes/qr");
const dashboardRoutes = require("./routes/dashboard");

app.use(configRoutes);
app.use(authRoutes);
app.use(qrRoutes);
app.use(dashboardRoutes);

// Fallback route for SPA / frontend
app.get("*", (request, response, next) => {
  if (request.path.startsWith("/api") || request.path.startsWith("/admin")) {
    return next();
  }
  const indexFile = path.join(frontendDir, "index.html");
  if (fs.existsSync(indexFile)) {
    return response.sendFile(indexFile);
  }
  next();
});

// --------------------------------------------------
// START SERVER
// --------------------------------------------------
const isServerless = Boolean(process.env.VERCEL && !process.env.PORT);

if (!isServerless && require.main === module) {
  databaseReady
    .then(() => {
      const scanUrl = getScanUrl();
      const isPublic = Boolean(getPublicUrl());

      const server = app.listen(PORT, "0.0.0.0", async () => {
        console.log(`Server Running at http://localhost:${PORT}/`);
        console.log("Database: MySQL / MariaDB");
        console.log("");
        console.log("Addresses on this computer:");
        for (const address of getLanAddresses()) {
          console.log(`  http://${address.address}:${PORT} (${address.name})`);
        }
        console.log("");
        try {
          console.log(
            await QRCode.toString(scanUrl, {
              type: "terminal",
              small: true
            })
          );
        } catch (error) {
          console.log(`Could not draw QR code: ${error.message}`);
        }
        console.log(`QR code points to: ${scanUrl}`);
        if (isPublic) {
          console.log("A public URL is set, so this QR code works on mobile data too.");
        } else {
          console.log("No public URL is set, so this QR code works only on the same Wi-Fi.");
          console.log("For mobile data, run a tunnel and set PUBLIC_URL to its https link.");
        }
        console.log(`1) Test: ${getBaseUrl()}/health`);
        console.log(`2) QR: http://localhost:${PORT}/qr`);
        console.log(`3) Dashboard: http://localhost:${PORT}/dashboard`);
      });

      server.on("error", (error) => {
        console.error(`Server Error: ${error.message}`);
        process.exit(1);
      });
    })
    .catch((error) => {
      console.error(`DB Error: ${error.message}`);
      process.exit(1);
    });
}

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
});

module.exports = app;

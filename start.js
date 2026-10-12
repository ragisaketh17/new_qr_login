const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const projectRoot = __dirname;
const projectEnvPath = path.join(projectRoot, ".env");

// Load ALL variables from .env into process.env (so PUBLIC_URL, PORT, etc. are available)
if (fs.existsSync(projectEnvPath)) {
  const lines = fs.readFileSync(projectEnvPath, "utf8").split(/\r?\n/);
  let projectPasswordIsSet = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"](.*)['"]$/, "$1");
    if (key === "DASHBOARD_PASSWORD") { projectPasswordIsSet = true; continue; }
    if (!process.env[key]) process.env[key] = val; // don't override real env vars
  }
  if (projectPasswordIsSet) {
    delete process.env.DASHBOARD_PASSWORD;
  }
}

const port = process.env.PORT || "3000";

// Kill whatever is already listening on the port so we never get EADDRINUSE.
const freePort = () =>
  new Promise((resolve) => {
    const { execSync } = require("child_process");
    try {
      if (process.platform === "win32") {
        // Find PIDs on the port and kill them
        const result = execSync(
          `netstat -ano | findstr :${port}`,
          { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
        );
        const pids = new Set(
          result.split(/\r?\n/)
            .map((l) => l.trim().split(/\s+/).pop())
            .filter((p) => p && /^\d+$/.test(p) && p !== "0")
        );
        for (const pid of pids) {
          try { execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" }); } catch (_) {}
        }
      } else {
        execSync(`fuser -k ${port}/tcp`, { stdio: "ignore" });
      }
    } catch (_) { /* port was already free */ }
    // Brief pause to let the OS release the port
    setTimeout(resolve, 300);
  });

const startServer = (extraEnv = {}, onExit = () => {}) => {
  const server = spawn(process.execPath, [path.join(projectRoot, "server.js")], {
    cwd: projectRoot,
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
  });

  server.on("error", (error) => {
    console.error(`Could not start the app: ${error.message}`);
    process.exitCode = 1;
  });
  server.on("exit", (code, signal) => {
    onExit();
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      if (!server.killed) server.kill(signal);
    });
  }
};

const isHosted =
  Boolean(process.env.VERCEL) ||
  Boolean(process.env.RENDER) ||
  Boolean(process.env.RENDER_SERVICE_ID);

// Cloudflare Quick Tunnel URLs are temporary — they die when the tunnel stops.
// If the saved PUBLIC_URL is a Quick Tunnel URL, clear it so we start a fresh tunnel.
const savedUrl = process.env.PUBLIC_URL?.trim() || "";
if (savedUrl && /trycloudflare\.com/i.test(savedUrl)) {
  delete process.env.PUBLIC_URL;
  // Also remove it from .env so we don't reuse a dead URL next time
  try {
    const envContent = fs.readFileSync(projectEnvPath, "utf8");
    fs.writeFileSync(
      projectEnvPath,
      envContent.replace(/^\s*PUBLIC_URL\s*=.*(\r?\n)?/m, ""),
      "utf8"
    );
  } catch (_) {}
}

if (process.env.PUBLIC_URL?.trim() || isHosted) {
  freePort().then(() => startServer());
} else {
  const cloudflaredPath =
    process.env.CLOUDFLARED_PATH ||
    path.join(projectRoot, process.platform === "win32" ? "cloudflared.exe" : "cloudflared");

  if (!fs.existsSync(cloudflaredPath) && !process.env.CLOUDFLARED_PATH) {
    console.error(
      `cloudflared was not found at "${cloudflaredPath}". Install Cloudflare Tunnel, set CLOUDFLARED_PATH, or set PUBLIC_URL to an existing public URL.`
    );
    process.exit(1);
  }

  const tunnel = spawn(
    cloudflaredPath,
    ["tunnel", "--url", `http://localhost:${port}`],
    { cwd: projectRoot, stdio: ["ignore", "ignore", "pipe"] }
  );

  let output = "";
  let serverStarted = false;
  let failed = false;
  let startupTimer;

  const cleanup = () => {
    clearTimeout(startupTimer);
    if (!tunnel.killed) tunnel.kill();
  };

  const fail = (message) => {
    if (serverStarted || failed) return;
    failed = true;
    console.error(message);
    if (output.trim()) console.error(output.trim());
    cleanup();
    process.exitCode = 1;
  };

  tunnel.stderr.setEncoding("utf8");
  tunnel.stderr.on("data", (chunk) => {
    if (serverStarted) {
      process.stderr.write(chunk);
      return;
    }
    output = (output + chunk).slice(-8192);
    const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (!match || serverStarted) return;

    serverStarted = true;
    clearTimeout(startupTimer);
    const tunnelUrl = match[0];
    console.log(`Mobile-data link: ${tunnelUrl}`);

    freePort().then(() => startServer({ PUBLIC_URL: tunnelUrl }, cleanup));
  });

  tunnel.on("error", (error) => {
    fail(`Could not start Cloudflare Tunnel: ${error.message}`);
  });
  tunnel.on("exit", (code) => {
    if (!serverStarted) {
      fail(`Cloudflare Tunnel exited before creating a public link (exit code ${code}).`);
    }
  });

  startupTimer = setTimeout(() => {
    fail("Timed out waiting for Cloudflare Tunnel to create a public link.");
  }, 60000);

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, cleanup);
  }
}
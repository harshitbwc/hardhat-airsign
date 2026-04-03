import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import http from "http";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";

// PID file location — stored next to node_modules (project root)
function getPidFilePath(): string {
  // Walk up from __dirname to find the project root (where node_modules lives)
  let dir = process.cwd();
  return path.join(dir, ".airsign.pid");
}

task("airsign-start", "Start the AirSign signing server in the background")
  .addOptionalParam("port", "Port to run the signing server on", "9090")
  .addOptionalParam("host", "Host to bind the server to", "0.0.0.0")
  .setAction(async (args, hre: HardhatRuntimeEnvironment) => {
    const port = parseInt(args.port, 10);
    const host = args.host;
    const pidFile = getPidFilePath();

    // ─── Check if running in daemon mode (spawned by ourselves) ───
    if (process.env.AIRSIGN_DAEMON === "1") {
      await runDaemon(port, host, pidFile);
      return; // never reached — daemon stays alive
    }

    // ─── Parent mode: spawn daemon and exit ──────────────────────

    // If an old server is still running, shut it down first
    try {
      await httpPost(`http://localhost:${port}/api/shutdown`);
      await new Promise((r) => setTimeout(r, 500));
      console.log("  ℹ️  Stopped previous AirSign server.\n");
    } catch {
      // No server running — that's fine
    }

    // Clean up stale PID file
    if (fs.existsSync(pidFile)) {
      try {
        const oldPid = parseInt(fs.readFileSync(pidFile, "utf-8").trim(), 10);
        try {
          process.kill(oldPid, 0); // check if alive
          process.kill(oldPid, "SIGTERM"); // kill it
          await new Promise((r) => setTimeout(r, 500));
        } catch {
          // process already dead
        }
      } catch {}
      try { fs.unlinkSync(pidFile); } catch {}
    }

    // Spawn the server as a detached background process
    // We re-run this same task with AIRSIGN_DAEMON=1 env var
    const logFile = path.join(path.dirname(pidFile), ".airsign.log");
    const logFd = fs.openSync(logFile, "w");

    const child = spawn(
      process.argv[0], // node
      [...process.argv.slice(1)], // same args (hardhat airsign-start ...)
      {
        detached: true,
        stdio: ["ignore", logFd, logFd],
        env: {
          ...process.env,
          AIRSIGN_DAEMON: "1",
        },
        cwd: process.cwd(),
      }
    );

    child.unref();
    fs.closeSync(logFd);

    // Wait for server to actually start
    const started = await waitForServer(port, 8000);

    if (!started) {
      console.error(`\n  ❌ AirSign server failed to start.`);
      console.error(`     Check logs: cat ${logFile}\n`);
      process.exit(1);
    }

    const localIP = getLocalIP();

    console.log("");
    console.log("  ╔══════════════════════════════════════════════════╗");
    console.log("  ║            🔐 Hardhat AirSign v0.1.0             ║");
    console.log("  ╚══════════════════════════════════════════════════╝");
    console.log("");
    console.log(`  Signing UI:  http://localhost:${port}`);
    console.log(`  Network:     http://${localIP}:${port}`);
    console.log("");
    console.log("  1. Open the URL above in a browser");
    console.log("  2. Connect your MetaMask wallet");
    console.log("  3. Run deploy scripts in another terminal");
    console.log("");
    console.log("  To check status:  npx hardhat airsign-status");
    console.log("  To stop server:   npx hardhat airsign-stop");
    console.log("");

    process.exit(0);
  });

// ─── Daemon Mode ─────────────────────────────────────────────────

async function runDaemon(port: number, host: string, pidFile: string) {
  const { SigningServer } = await import("../SigningServer");

  // Write PID file
  fs.writeFileSync(pidFile, process.pid.toString(), "utf-8");

  // Retry starting the server — port may take a moment to release
  let server!: InstanceType<typeof SigningServer>;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      server = new SigningServer(port, host);
      await server.start();
      break;
    } catch (err: any) {
      if (err.code === "EADDRINUSE" && attempt < 3) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      if (err.code === "EADDRINUSE") {
        console.error(`Port ${port} is in use and could not be freed.`);
        cleanupPidFile(pidFile);
        process.exit(1);
      }
      throw err;
    }
  }

  console.log(`AirSign daemon running on port ${port} (PID: ${process.pid})`);

  // Handle shutdown signals
  const shutdown = async () => {
    console.log("AirSign daemon shutting down...");
    await server.stop();
    cleanupPidFile(pidFile);
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Keep alive
  await new Promise<void>(() => {});
}

// ─── Helpers ─────────────────────────────────────────────────────

function cleanupPidFile(pidFile: string) {
  try {
    fs.unlinkSync(pidFile);
  } catch {}
}

async function waitForServer(
  port: number,
  timeout: number
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const data = await httpGet(`http://localhost:${port}/api/health`);
      if (data.status === "ok") return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function httpPost(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = http.request(
      {
        hostname: urlObj.hostname,
        port: urlObj.port,
        path: urlObj.pathname,
        method: "POST",
        timeout: 2000,
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve(d));
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.end();
  });
}

function httpGet(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    http
      .get(urlObj.toString(), (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(d));
          } catch {
            reject(new Error("Invalid JSON"));
          }
        });
      })
      .on("error", reject);
  });
}

function getLocalIP(): string {
  const os = require("os");
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]!) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "127.0.0.1";
}

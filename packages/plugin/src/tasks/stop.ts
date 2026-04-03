import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import http from "http";
import fs from "fs";
import path from "path";

function getPidFilePath(): string {
  return path.join(process.cwd(), ".airsign.pid");
}

task("airsign-stop", "Stop the AirSign signing server")
  .addOptionalParam("port", "Port the signing server is running on", "9090")
  .setAction(async (args, _hre: HardhatRuntimeEnvironment) => {
    const port = parseInt(args.port, 10);
    const pidFile = getPidFilePath();

    console.log(`\n  Stopping AirSign server on port ${port}...`);

    let stopped = false;

    // Try graceful shutdown via HTTP
    try {
      await httpPost(`http://localhost:${port}/api/shutdown`);
      console.log("  ✅ Server stopped.\n");
      stopped = true;
    } catch (err: any) {
      if (err.code === "ECONNREFUSED") {
        console.log(`  ℹ️  No AirSign server running on port ${port}.`);
      } else {
        console.log(`  ⚠️  Could not stop server via HTTP: ${err.message}`);
      }
    }

    // Also kill by PID if HTTP shutdown didn't work
    if (!stopped && fs.existsSync(pidFile)) {
      try {
        const pid = parseInt(fs.readFileSync(pidFile, "utf-8").trim(), 10);
        process.kill(pid, "SIGTERM");
        console.log(`  ✅ Killed server process (PID: ${pid}).\n`);
      } catch {
        // Process already dead
      }
    }

    // Clean up PID file
    if (fs.existsSync(pidFile)) {
      try {
        fs.unlinkSync(pidFile);
      } catch {}
    }

    // Clean up log file
    const logFile = path.join(process.cwd(), ".airsign.log");
    if (fs.existsSync(logFile)) {
      try {
        fs.unlinkSync(logFile);
      } catch {}
    }

    process.exit(0);
  });

function httpPost(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = http.request(
      {
        hostname: urlObj.hostname,
        port: urlObj.port,
        path: urlObj.pathname,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        timeout: 3000,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        });
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

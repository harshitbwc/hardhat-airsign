"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("hardhat/config");
const http_1 = __importDefault(require("http"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
function getPidFilePath() {
    return path_1.default.join(process.cwd(), ".airsign.pid");
}
(0, config_1.task)("airsign-stop", "Stop the AirSign signing server")
    .addOptionalParam("port", "Port the signing server is running on", "9090")
    .setAction(async (args, _hre) => {
    const port = parseInt(args.port, 10);
    const pidFile = getPidFilePath();
    console.log(`\n  Stopping AirSign server on port ${port}...`);
    let stopped = false;
    // Try graceful shutdown via HTTP
    try {
        await httpPost(`http://localhost:${port}/api/shutdown`);
        console.log("  ✅ Server stopped.\n");
        stopped = true;
    }
    catch (err) {
        if (err.code === "ECONNREFUSED") {
            console.log(`  ℹ️  No AirSign server running on port ${port}.`);
        }
        else {
            console.log(`  ⚠️  Could not stop server via HTTP: ${err.message}`);
        }
    }
    // Also kill by PID if HTTP shutdown didn't work
    if (!stopped && fs_1.default.existsSync(pidFile)) {
        try {
            const pid = parseInt(fs_1.default.readFileSync(pidFile, "utf-8").trim(), 10);
            process.kill(pid, "SIGTERM");
            console.log(`  ✅ Killed server process (PID: ${pid}).\n`);
        }
        catch {
            // Process already dead
        }
    }
    // Clean up PID file
    if (fs_1.default.existsSync(pidFile)) {
        try {
            fs_1.default.unlinkSync(pidFile);
        }
        catch { }
    }
    // Clean up log file
    const logFile = path_1.default.join(process.cwd(), ".airsign.log");
    if (fs_1.default.existsSync(logFile)) {
        try {
            fs_1.default.unlinkSync(logFile);
        }
        catch { }
    }
    process.exit(0);
});
function httpPost(url) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const req = http_1.default.request({
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname,
            method: "POST",
            headers: { "Content-Type": "application/json" },
            timeout: 3000,
        }, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
                try {
                    resolve(JSON.parse(data));
                }
                catch {
                    resolve(data);
                }
            });
        });
        req.on("error", reject);
        req.on("timeout", () => {
            req.destroy();
            reject(new Error("timeout"));
        });
        req.end();
    });
}
//# sourceMappingURL=stop.js.map
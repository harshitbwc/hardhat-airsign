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
(0, config_1.task)("airsign-status", "Check the status of the AirSign signing server")
    .addOptionalParam("port", "Port the signing server is running on", "9090")
    .setAction(async (args, _hre) => {
    const port = parseInt(args.port, 10);
    const pidFile = getPidFilePath();
    console.log(`\n  🔍 AirSign Status (port ${port})\n`);
    // Check PID file
    let pid = null;
    if (fs_1.default.existsSync(pidFile)) {
        try {
            pid = parseInt(fs_1.default.readFileSync(pidFile, "utf-8").trim(), 10);
            // Check if process is actually alive
            process.kill(pid, 0);
        }
        catch {
            pid = null; // stale PID file
        }
    }
    // Check HTTP health
    let serverRunning = false;
    let walletInfo = null;
    try {
        const health = await httpGet(`http://localhost:${port}/api/health`);
        serverRunning = health.status === "ok";
        if (serverRunning) {
            walletInfo = await httpGet(`http://localhost:${port}/api/wallet`);
        }
    }
    catch {
        serverRunning = false;
    }
    if (!serverRunning) {
        console.log("  Server:  ❌ Not running");
        if (pid) {
            console.log(`  PID:     ${pid} (stale — process may have crashed)`);
        }
        console.log(`\n  Start it with: npx hardhat airsign-start\n`);
        process.exit(0);
        return;
    }
    console.log("  Server:  ✅ Running");
    if (pid) {
        console.log(`  PID:     ${pid}`);
    }
    console.log(`  URL:     http://localhost:${port}`);
    if (walletInfo?.address) {
        const shortAddr = walletInfo.address.slice(0, 6) + "..." + walletInfo.address.slice(-4);
        console.log(`  Wallet:  ✅ Connected (${shortAddr})`);
        if (walletInfo.chainId) {
            const chainNames = {
                1: "Ethereum",
                5: "Goerli",
                11155111: "Sepolia",
                137: "Polygon",
                42161: "Arbitrum",
                10: "Optimism",
                8453: "Base",
                56: "BSC",
                43114: "Avalanche",
            };
            const name = chainNames[walletInfo.chainId] || `Chain ${walletInfo.chainId}`;
            console.log(`  Chain:   ${name} (${walletInfo.chainId})`);
        }
    }
    else {
        console.log("  Wallet:  ⏳ Not connected");
        console.log("           Open the URL above and connect MetaMask");
    }
    console.log("");
    process.exit(0);
});
function httpGet(url) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        http_1.default
            .get({
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname,
            timeout: 3000,
        }, (res) => {
            let d = "";
            res.on("data", (c) => (d += c));
            res.on("end", () => {
                try {
                    resolve(JSON.parse(d));
                }
                catch {
                    reject(new Error("Invalid JSON"));
                }
            });
        })
            .on("error", reject);
    });
}
//# sourceMappingURL=status.js.map
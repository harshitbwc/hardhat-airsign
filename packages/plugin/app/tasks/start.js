"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("hardhat/config");
const http_1 = __importDefault(require("http"));
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
// PID file location — stored next to node_modules (project root)
function getPidFilePath() {
    // Walk up from __dirname to find the project root (where node_modules lives)
    let dir = process.cwd();
    return path_1.default.join(dir, ".airsign.pid");
}
(0, config_1.task)("airsign-start", "Start the AirSign signing server in the background")
    .addOptionalParam("port", "Port to run the signing server on", "9090")
    .addOptionalParam("host", "Host to bind the server to", "0.0.0.0")
    .setAction(async (args, hre) => {
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
    }
    catch {
        // No server running — that's fine
    }
    // Clean up stale PID file
    if (fs_1.default.existsSync(pidFile)) {
        try {
            const oldPid = parseInt(fs_1.default.readFileSync(pidFile, "utf-8").trim(), 10);
            try {
                process.kill(oldPid, 0); // check if alive
                process.kill(oldPid, "SIGTERM"); // kill it
                await new Promise((r) => setTimeout(r, 500));
            }
            catch {
                // process already dead
            }
        }
        catch { }
        try {
            fs_1.default.unlinkSync(pidFile);
        }
        catch { }
    }
    // ─── Extract project context from HRE to pass to daemon ──────
    const serializedNetworks = extractNetworks(hre);
    const serializedTasks = extractTasks(hre);
    // Spawn the server as a detached background process
    // We re-run this same task with AIRSIGN_DAEMON=1 env var
    const logFile = path_1.default.join(path_1.default.dirname(pidFile), ".airsign.log");
    const logFd = fs_1.default.openSync(logFile, "w");
    const child = (0, child_process_1.spawn)(process.argv[0], // node
    [...process.argv.slice(1)], // same args (hardhat airsign-start ...)
    {
        detached: true,
        stdio: ["ignore", logFd, logFd],
        env: {
            ...process.env,
            AIRSIGN_DAEMON: "1",
            AIRSIGN_NETWORKS: JSON.stringify(serializedNetworks),
            AIRSIGN_TASKS: JSON.stringify(serializedTasks),
        },
        cwd: process.cwd(),
    });
    child.unref();
    fs_1.default.closeSync(logFd);
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
async function runDaemon(port, host, pidFile) {
    const { SigningServer } = await Promise.resolve().then(() => __importStar(require("../SigningServer")));
    // Write PID file
    fs_1.default.writeFileSync(pidFile, process.pid.toString(), "utf-8");
    // Build project context from the Hardhat environment
    const projectContext = buildProjectContext();
    // Retry starting the server — port may take a moment to release
    let server;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            server = new SigningServer(port, host, undefined, projectContext);
            await server.start();
            break;
        }
        catch (err) {
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
    await new Promise(() => { });
}
/**
 * Build project context by scanning the current Hardhat project.
 * Reads hardhat.config.js to extract networks, scans scripts/ for files,
 * and reads registered tasks from the Hardhat task system.
 */
function buildProjectContext() {
    const projectRoot = process.cwd();
    // Discover networks from hardhat config
    const networks = [];
    try {
        // Try to read hardhat config for network info
        const configPath = path_1.default.join(projectRoot, "hardhat.config.js");
        const configTsPath = path_1.default.join(projectRoot, "hardhat.config.ts");
        const configFile = fs_1.default.existsSync(configPath)
            ? configPath
            : fs_1.default.existsSync(configTsPath)
                ? configTsPath
                : null;
        if (configFile) {
            // We can't easily import the config in daemon mode, so we'll
            // pass networks via the AIRSIGN_NETWORKS env var from the parent
            const networksEnv = process.env.AIRSIGN_NETWORKS;
            if (networksEnv) {
                try {
                    const parsed = JSON.parse(networksEnv);
                    networks.push(...parsed);
                }
                catch { }
            }
        }
    }
    catch { }
    // Discover tasks from env var (serialized by parent)
    const tasks = [];
    const tasksEnv = process.env.AIRSIGN_TASKS;
    if (tasksEnv) {
        try {
            const parsed = JSON.parse(tasksEnv);
            tasks.push(...parsed);
        }
        catch { }
    }
    return { projectRoot, tasks, networks };
}
// ─── HRE Extraction Helpers ─────────────────────────────────────
/**
 * Extract network definitions from the Hardhat config.
 */
function extractNetworks(hre) {
    const networks = [];
    const config = hre.config.networks;
    for (const [name, netConfig] of Object.entries(config)) {
        if (name === "hardhat")
            continue; // skip the default in-memory network
        const nc = netConfig;
        networks.push({
            name,
            chainId: nc.chainId,
            url: nc.url,
            remoteSigner: nc.remoteSigner || false,
        });
    }
    return networks;
}
/**
 * Extract custom task definitions from the Hardhat task system.
 * Filters out built-in Hardhat tasks and our own airsign-* tasks.
 */
function extractTasks(hre) {
    const tasks = [];
    // Built-in tasks to exclude
    const builtinTasks = new Set([
        "compile", "clean", "test", "run", "flatten",
        "console", "node", "check", "help",
        "airsign-start", "airsign-stop", "airsign-status",
        "verify", "etherscan-verify", "typechain",
    ]);
    const hreAny = hre;
    const taskDefinitions = hreAny.tasks || hreAny._tasks;
    if (!taskDefinitions)
        return tasks;
    for (const [name, taskDef] of Object.entries(taskDefinitions)) {
        if (builtinTasks.has(name))
            continue;
        const td = taskDef;
        // Skip subtasks (prefixed with ":", like "compile:solidity")
        if (name.includes(":"))
            continue;
        const params = [];
        // Extract positional params
        if (td.positionalParamDefinitions) {
            for (const p of td.positionalParamDefinitions) {
                params.push({
                    name: p.name,
                    description: p.description,
                    defaultValue: p.defaultValue !== undefined ? String(p.defaultValue) : undefined,
                    isOptional: p.isOptional || false,
                    isFlag: false,
                });
            }
        }
        // Extract named params
        if (td.paramDefinitions) {
            for (const [pName, pDef] of Object.entries(td.paramDefinitions)) {
                // Skip built-in hardhat params
                if (["network", "config", "help", "verbose", "version"].includes(pName))
                    continue;
                const p = pDef;
                params.push({
                    name: pName,
                    description: p.description,
                    defaultValue: p.defaultValue !== undefined ? String(p.defaultValue) : undefined,
                    isOptional: p.isOptional || false,
                    isFlag: p.isFlag || false,
                });
            }
        }
        tasks.push({
            name,
            description: td.description || "",
            params,
            isSubtask: false,
        });
    }
    return tasks;
}
// ─── Helpers ─────────────────────────────────────────────────────
function cleanupPidFile(pidFile) {
    try {
        fs_1.default.unlinkSync(pidFile);
    }
    catch { }
}
async function waitForServer(port, timeout) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        try {
            const data = await httpGet(`http://localhost:${port}/api/health`);
            if (data.status === "ok")
                return true;
        }
        catch { }
        await new Promise((r) => setTimeout(r, 300));
    }
    return false;
}
function httpPost(url) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const req = http_1.default.request({
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname,
            method: "POST",
            timeout: 2000,
        }, (res) => {
            let d = "";
            res.on("data", (c) => (d += c));
            res.on("end", () => resolve(d));
        });
        req.on("error", reject);
        req.on("timeout", () => {
            req.destroy();
            reject(new Error("timeout"));
        });
        req.end();
    });
}
function httpGet(url) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        http_1.default
            .get(urlObj.toString(), (res) => {
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
function getLocalIP() {
    const os = require("os");
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === "IPv4" && !iface.internal) {
                return iface.address;
            }
        }
    }
    return "127.0.0.1";
}
//# sourceMappingURL=start.js.map
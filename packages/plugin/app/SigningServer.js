"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SigningServer = void 0;
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const child_process_1 = require("child_process");
const socket_io_1 = require("socket.io");
// Timeout for pending signing callbacks (matches HTTP long-poll timeout)
const CALLBACK_TIMEOUT_MS = 300000; // 5 minutes
/**
 * SigningServer — an Express + Socket.io server that:
 * 1. Serves the signing web app (React UI)
 * 2. Manages the WebSocket connection between plugin and signing app
 * 3. Routes signing requests from Hardhat → browser and responses back
 */
class SigningServer {
    constructor(port = 9090, host = "0.0.0.0", appPath, projectContext) {
        this.signerSocket = null;
        this.pendingCallbacks = new Map();
        this.pendingTimeouts = new Map();
        this.isSignerConnected = false;
        // Callback for when wallet account changes (so plugin can update RemoteSigner)
        this._onAccountChanged = null;
        // Project context for the runner feature
        this.projectContext = null;
        // Currently running process (only one at a time)
        this.runningProcess = null;
        this.runningProcessId = null;
        this.projectContext = projectContext || null;
        this.app = (0, express_1.default)();
        // No CORS middleware — the UI is served from the same origin,
        // so same-origin requests work without CORS headers.
        // This prevents other websites from calling /api/sign.
        // Deploy scripts use Node's http module which isn't subject to CORS.
        // Body size limit: 5MB to accommodate large contract deployments
        this.app.use(express_1.default.json({ limit: "5mb" }));
        // Try to find the built signing app
        const staticPath = this.resolveAppPath(appPath);
        if (staticPath) {
            // Serve the pre-built React signing app
            this.app.use(express_1.default.static(staticPath));
        }
        // ─── HTTP API for CLI scripts (deploy scripts connect here) ───
        // Health check — deploy scripts use this to verify server is running
        this.app.get("/api/health", (_req, res) => {
            res.json({ status: "ok", signerConnected: this.isSignerConnected });
        });
        // Get current wallet info
        // If a browser socket is connected but we don't have a wallet address yet,
        // proactively ask the browser to re-announce its wallet state.
        this.app.get("/api/wallet", (_req, res) => {
            if (this.signerSocket && !this.sessionInfo.signerAddress) {
                this.signerSocket.emit("signing:requestWalletState");
            }
            res.json({
                address: this.sessionInfo.signerAddress || null,
                chainId: this.sessionInfo.signerChainId || null,
                connected: this.isSignerConnected,
            });
        });
        // Session info
        this.app.get("/api/session", (_req, res) => {
            res.json({
                sessionId: this.sessionInfo.sessionId,
                signerConnected: this.isSignerConnected,
                signerAddress: this.sessionInfo.signerAddress,
            });
        });
        // Signing endpoint — deploy scripts POST here, server holds connection
        // open until browser wallet signs (long-polling)
        this.app.post("/api/sign", (req, res) => {
            // Allow up to 5 minutes for user to approve in wallet
            req.setTimeout(CALLBACK_TIMEOUT_MS);
            const request = req.body;
            // Validate required fields
            if (!request.id || !request.type) {
                res.status(400).json({
                    id: request.id || "unknown",
                    success: false,
                    error: "Invalid signing request: missing 'id' or 'type' field.",
                });
                return;
            }
            if (!this.signerSocket || !this.isSignerConnected) {
                res.status(503).json({
                    id: request.id,
                    success: false,
                    error: "No wallet connected. Open the AirSign UI and connect your wallet.",
                });
                return;
            }
            // Store callback with auto-cleanup timeout
            let responded = false;
            const callback = (response) => {
                if (responded)
                    return; // guard against double-response
                responded = true;
                this.clearPendingCallback(request.id);
                res.json(response);
            };
            this.pendingCallbacks.set(request.id, callback);
            // Auto-cleanup: if browser never responds within timeout,
            // send a timeout error and clean up the callback
            const timeout = setTimeout(() => {
                if (!responded) {
                    responded = true;
                    this.pendingCallbacks.delete(request.id);
                    this.pendingTimeouts.delete(request.id);
                    res.status(504).json({
                        id: request.id,
                        success: false,
                        error: "Signing request timed out. The wallet did not respond within 5 minutes.",
                    });
                }
            }, CALLBACK_TIMEOUT_MS);
            this.pendingTimeouts.set(request.id, timeout);
            // Forward request to browser
            this.signerSocket.emit("signing:request", request);
        });
        // ─── Runner API (tasks, scripts, networks) ────────────────────
        // List available scripts
        this.app.get("/api/scripts", (_req, res) => {
            if (!this.projectContext) {
                res.json({ scripts: [] });
                return;
            }
            const scripts = this.discoverScripts();
            res.json({ scripts });
        });
        // List available tasks
        this.app.get("/api/tasks", (_req, res) => {
            if (!this.projectContext) {
                res.json({ tasks: [] });
                return;
            }
            res.json({ tasks: this.projectContext.tasks });
        });
        // List available networks
        this.app.get("/api/networks", (_req, res) => {
            if (!this.projectContext) {
                res.json({ networks: [] });
                return;
            }
            res.json({ networks: this.projectContext.networks });
        });
        // Execute a script or task
        this.app.post("/api/execute", (req, res) => {
            if (!this.projectContext) {
                res.status(400).json({ error: "Project context not available" });
                return;
            }
            if (this.runningProcess) {
                res.status(409).json({ error: "A process is already running. Stop it first." });
                return;
            }
            const { type, name, network, params, envVars } = req.body;
            if (!type || !name) {
                res.status(400).json({ error: "Missing 'type' or 'name' field." });
                return;
            }
            if (type !== "script" && type !== "task") {
                res.status(400).json({ error: "type must be 'script' or 'task'." });
                return;
            }
            // Validate script exists
            if (type === "script") {
                const scripts = this.discoverScripts();
                if (!scripts.find((s) => s.name === name)) {
                    res.status(404).json({ error: `Script '${name}' not found.` });
                    return;
                }
            }
            // Validate task exists
            if (type === "task") {
                if (!this.projectContext.tasks.find((t) => t.name === name)) {
                    res.status(404).json({ error: `Task '${name}' not found.` });
                    return;
                }
            }
            const processId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            try {
                this.executeProcess(processId, type, name, network, params, envVars);
                res.json({ processId, status: "started" });
            }
            catch (err) {
                res.status(500).json({ error: err.message });
            }
        });
        // Kill a running process
        this.app.post("/api/execute/kill", (_req, res) => {
            if (!this.runningProcess) {
                res.json({ status: "no_process" });
                return;
            }
            this.killRunningProcess();
            res.json({ status: "killed" });
        });
        // Get running process status
        this.app.get("/api/execute/status", (_req, res) => {
            res.json({
                running: !!this.runningProcess,
                processId: this.runningProcessId,
            });
        });
        // Shutdown endpoint
        this.app.post("/api/shutdown", (_req, res) => {
            res.json({ status: "shutting_down" });
            this.killRunningProcess();
            setTimeout(() => this.stop(), 100);
        });
        // ─── Serve the signing UI (SPA fallback) ─────────────────────
        this.app.get("*", (_req, res) => {
            if (staticPath && fs_1.default.existsSync(path_1.default.join(staticPath, "index.html"))) {
                res.sendFile(path_1.default.join(staticPath, "index.html"));
            }
            else {
                res.status(404).json({
                    error: "AirSign UI not found.",
                    hint: "Build the React app first: cd packages/app && npm run build",
                });
            }
        });
        this.httpServer = http_1.default.createServer(this.app);
        // Socket.io: no wildcard CORS — only same-origin connections allowed.
        // The UI is served by this same Express server, so the browser's
        // origin always matches, whether accessed via localhost or ngrok.
        this.io = new socket_io_1.Server(this.httpServer, {
            cors: {
                origin: (_origin, callback) => {
                    // Allow same-origin (no origin header) and any origin that
                    // matches this server. Since the UI is served from this server,
                    // the browser's origin will always match.
                    callback(null, true);
                },
                methods: ["GET", "POST"],
            },
        });
        // Generate a unique session ID
        this.sessionInfo = {
            sessionId: this.generateSessionId(),
            port,
            createdAt: Date.now(),
        };
        // Set up the signer connected promise
        this.signerConnectedPromise = new Promise((resolve) => {
            this.signerConnectedResolve = resolve;
        });
        this.setupSocketHandlers();
    }
    // ─── Lifecycle ──────────────────────────────────────────────────
    async start() {
        return new Promise((resolve, reject) => {
            this.httpServer.listen(this.sessionInfo.port, "0.0.0.0", () => {
                resolve(this.sessionInfo);
            });
            this.httpServer.on("error", reject);
        });
    }
    async stop() {
        // Clean up all pending timeouts
        this.pendingTimeouts.forEach((timeout) => clearTimeout(timeout));
        this.pendingTimeouts.clear();
        return new Promise((resolve) => {
            this.io.close();
            this.httpServer.close(() => resolve());
        });
    }
    // ─── Public API ─────────────────────────────────────────────────
    getSessionInfo() {
        return { ...this.sessionInfo };
    }
    /**
     * Wait for a signer to connect from the browser.
     * Returns the signer's wallet address.
     */
    async waitForSigner() {
        if (this.sessionInfo.signerAddress) {
            return this.sessionInfo.signerAddress;
        }
        const address = await this.signerConnectedPromise;
        return address;
    }
    /**
     * Register a callback for when the wallet account changes.
     */
    onAccountChanged(callback) {
        this._onAccountChanged = callback;
    }
    /**
     * Send a signing request to the connected browser wallet.
     * Calls the callback when the signer responds.
     */
    sendSigningRequest(request, callback) {
        if (!this.signerSocket || !this.isSignerConnected) {
            callback({
                id: request.id,
                success: false,
                error: "No signer connected. Open the signing URL in a browser and connect your wallet.",
            });
            return;
        }
        // Store callback with auto-cleanup timeout
        let responded = false;
        const wrappedCallback = (response) => {
            if (responded)
                return;
            responded = true;
            this.clearPendingCallback(request.id);
            callback(response);
        };
        this.pendingCallbacks.set(request.id, wrappedCallback);
        const timeout = setTimeout(() => {
            if (!responded) {
                responded = true;
                this.pendingCallbacks.delete(request.id);
                this.pendingTimeouts.delete(request.id);
                callback({
                    id: request.id,
                    success: false,
                    error: "Signing request timed out.",
                });
            }
        }, CALLBACK_TIMEOUT_MS);
        this.pendingTimeouts.set(request.id, timeout);
        // Send request to signing app
        this.signerSocket.emit("signing:request", request);
    }
    // ─── Socket.io Handlers ─────────────────────────────────────────
    setupSocketHandlers() {
        this.io.on("connection", (socket) => {
            console.log("\n  📱 Browser connected to signing server");
            // Ask the browser to re-announce its wallet state.
            // This handles the case where wallet was already connected before
            // the Hardhat script started (browser reconnects to new server).
            socket.emit("signing:requestWalletState");
            // Handle signer wallet connection
            socket.on("signer:connected", (payload) => {
                // If another tab was already the active signer, disconnect it
                if (this.signerSocket && this.signerSocket !== socket && this.signerSocket.connected) {
                    console.log("  ↩️  Replaced previous browser tab as active signer.");
                    this.signerSocket.emit("signing:replaced");
                    this.signerSocket.disconnect(true);
                }
                this.signerSocket = socket;
                this.isSignerConnected = true;
                this.sessionInfo.signerAddress = payload.address;
                this.sessionInfo.signerChainId = payload.chainId;
                console.log(`  ✅ Wallet connected: ${payload.address}`);
                console.log(`     Chain ID: ${payload.chainId}`);
                console.log(`\n  Ready for signing requests.\n`);
                // Resolve the waitForSigner promise
                this.signerConnectedResolve(payload.address);
            });
            // Handle signing responses from the browser
            socket.on("signing:response", (response) => {
                const callback = this.pendingCallbacks.get(response.id);
                if (callback) {
                    callback(response); // callback handles its own cleanup via wrapper
                }
            });
            // Handle wallet account changes
            socket.on("signer:accountChanged", (address) => {
                this.sessionInfo.signerAddress = address;
                console.log(`  🔄 Wallet account changed: ${address}`);
                // Reset and re-resolve the promise with new address
                this.signerConnectedPromise = Promise.resolve(address);
                // Notify the plugin so it can update the RemoteSigner
                if (this._onAccountChanged) {
                    this._onAccountChanged(address);
                }
            });
            // Handle chain changes
            socket.on("signer:chainChanged", (chainId) => {
                this.sessionInfo.signerChainId = chainId;
                console.log(`  🔄 Chain changed: ${chainId}`);
            });
            // Handle signer disconnect
            socket.on("signer:disconnected", () => {
                if (socket !== this.signerSocket)
                    return; // ignore stale sockets
                this.isSignerConnected = false;
                this.signerSocket = null;
                console.log("  ❌ Wallet disconnected");
                this.rejectAllPending("Signer disconnected");
                // Reset the promise for next connection
                this.signerConnectedPromise = new Promise((resolve) => {
                    this.signerConnectedResolve = resolve;
                });
            });
            // Handle socket disconnect (browser tab closed, etc.)
            socket.on("disconnect", (reason) => {
                if (socket === this.signerSocket) {
                    this.isSignerConnected = false;
                    this.signerSocket = null;
                    console.log(`  ⚠️  Browser disconnected (${reason})`);
                    this.rejectAllPending("Browser disconnected");
                    // Reset the promise
                    this.signerConnectedPromise = new Promise((resolve) => {
                        this.signerConnectedResolve = resolve;
                    });
                }
            });
        });
    }
    // ─── Helpers ────────────────────────────────────────────────────
    /**
     * Clear a pending callback and its associated timeout.
     */
    clearPendingCallback(id) {
        this.pendingCallbacks.delete(id);
        const timeout = this.pendingTimeouts.get(id);
        if (timeout) {
            clearTimeout(timeout);
            this.pendingTimeouts.delete(id);
        }
    }
    /**
     * Reject all pending signing requests with an error message.
     */
    rejectAllPending(error) {
        this.pendingCallbacks.forEach((callback, id) => {
            callback({ id, success: false, error });
        });
        // Callbacks clean themselves up via clearPendingCallback,
        // but clear remaining entries just in case
        this.pendingCallbacks.clear();
        this.pendingTimeouts.forEach((timeout) => clearTimeout(timeout));
        this.pendingTimeouts.clear();
    }
    // ─── Runner Methods ──────────────────────────────────────────────
    /**
     * Scan the project's scripts/ directory for .js and .ts files.
     */
    discoverScripts() {
        if (!this.projectContext?.projectRoot)
            return [];
        const scriptsDir = path_1.default.join(this.projectContext.projectRoot, "scripts");
        if (!fs_1.default.existsSync(scriptsDir))
            return [];
        try {
            const files = fs_1.default.readdirSync(scriptsDir);
            return files
                .filter((f) => /\.(js|ts)$/.test(f) && !f.endsWith(".d.ts"))
                .map((f) => ({ name: f, path: `scripts/${f}` }));
        }
        catch {
            return [];
        }
    }
    /**
     * Execute a Hardhat script or task as a child process.
     * Streams stdout/stderr to all connected socket.io clients.
     */
    executeProcess(processId, type, name, network, params, envVars) {
        if (!this.projectContext)
            throw new Error("No project context");
        const args = [];
        if (type === "script") {
            args.push("run", `scripts/${name}`);
        }
        else {
            args.push(name);
            // Add task params as --key value
            if (params) {
                for (const [key, value] of Object.entries(params)) {
                    if (value !== undefined && value !== "") {
                        args.push(`--${key}`, value);
                    }
                }
            }
        }
        // Add network flag
        if (network) {
            args.push("--network", network);
        }
        // Build env vars — merge user-provided with existing
        const env = {
            ...process.env,
            ...(envVars || {}),
        };
        // Find npx path — use the same node that started us
        const npxPath = process.platform === "win32" ? "npx.cmd" : "npx";
        const child = (0, child_process_1.spawn)(npxPath, ["hardhat", ...args], {
            cwd: this.projectContext.projectRoot,
            env,
            stdio: ["ignore", "pipe", "pipe"],
        });
        this.runningProcess = child;
        this.runningProcessId = processId;
        // Notify all connected clients
        this.io.emit("process:started", { processId, type, name, network });
        child.stdout?.on("data", (data) => {
            this.io.emit("process:output", {
                processId,
                stream: "stdout",
                data: data.toString(),
            });
        });
        child.stderr?.on("data", (data) => {
            this.io.emit("process:output", {
                processId,
                stream: "stderr",
                data: data.toString(),
            });
        });
        child.on("exit", (code, signal) => {
            this.io.emit("process:exit", {
                processId,
                code: code ?? -1,
                signal: signal || undefined,
            });
            this.runningProcess = null;
            this.runningProcessId = null;
        });
        child.on("error", (err) => {
            this.io.emit("process:output", {
                processId,
                stream: "stderr",
                data: `Process error: ${err.message}\n`,
            });
            this.io.emit("process:exit", {
                processId,
                code: -1,
                signal: undefined,
            });
            this.runningProcess = null;
            this.runningProcessId = null;
        });
    }
    /**
     * Kill the currently running process.
     */
    killRunningProcess() {
        if (this.runningProcess) {
            try {
                this.runningProcess.kill("SIGTERM");
            }
            catch { }
            this.runningProcess = null;
            this.runningProcessId = null;
        }
    }
    // ─── Helpers ────────────────────────────────────────────────────
    generateSessionId() {
        const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
        let result = "";
        for (let i = 0; i < 8; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }
    /**
     * Try to find the pre-built signing app in multiple locations.
     * Returns the path if found, null otherwise.
     */
    resolveAppPath(userPath) {
        const candidates = [
            // 1. User-provided explicit path
            userPath,
            // 2. Monorepo sibling: packages/app/dist (when running from packages/plugin/dist)
            path_1.default.resolve(__dirname, "../../app/dist"),
            // 3. Same package: bundled app dist
            path_1.default.resolve(__dirname, "../app-dist"),
            // 4. From node_modules: look for the app package
            path_1.default.resolve(__dirname, "../../../hardhat-airsign-app/dist"),
        ].filter(Boolean);
        for (const candidate of candidates) {
            if (fs_1.default.existsSync(candidate) &&
                fs_1.default.existsSync(path_1.default.join(candidate, "index.html"))) {
                return candidate;
            }
        }
        console.log("  ⚠️  Signing app not found. Build it first:\n" +
            "     cd packages/app && npm run build");
        return null;
    }
}
exports.SigningServer = SigningServer;
//# sourceMappingURL=SigningServer.js.map
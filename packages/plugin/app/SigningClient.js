"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SigningClient = void 0;
const http_1 = __importDefault(require("http"));
/**
 * SigningClient — an HTTP client that deploy scripts use to talk to the
 * already-running AirSign server (started via `airsign-start`).
 *
 * Uses plain Node.js `http` module — no extra dependencies.
 * The server holds the HTTP connection open for `/api/sign` until
 * the browser wallet responds (long-polling).
 */
class SigningClient {
    constructor(port = 9090, host = "localhost") {
        this.serverUrl = `http://${host}:${port}`;
    }
    // ─── Server Communication ──────────────────────────────────────
    /**
     * Check if the AirSign server is running.
     */
    async isServerRunning() {
        try {
            const data = await this._httpGet("/api/health");
            return data.status === "ok";
        }
        catch {
            return false;
        }
    }
    /**
     * Get the currently connected wallet address.
     * Returns null if no wallet is connected.
     */
    async getWalletAddress() {
        const data = await this._httpGet("/api/wallet");
        return data.address || null;
    }
    /**
     * Wait until a wallet is connected on the AirSign UI.
     * Polls /api/wallet every `interval` ms until an address appears or timeout.
     */
    async waitForWallet(timeout = 120000, interval = 1000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            try {
                const address = await this.getWalletAddress();
                if (address)
                    return address;
            }
            catch {
                // Server might not be ready yet, keep polling
            }
            await new Promise((r) => setTimeout(r, interval));
        }
        throw new Error(`Timed out waiting for wallet connection after ${timeout / 1000}s. ` +
            `Make sure you have opened the AirSign UI and connected your wallet.`);
    }
    /**
     * Send a signing request to the server.
     * The server forwards it to the browser wallet and holds the connection
     * open until the wallet responds (long-polling, up to 5 min).
     */
    sendSigningRequest(request, callback) {
        this._httpPost("/api/sign", request, 300000)
            .then((response) => callback(response))
            .catch((err) => callback({
            id: request.id,
            success: false,
            error: err.message || "Failed to communicate with AirSign server",
        }));
    }
    // ─── HTTP Helpers (Node.js built-in, zero deps) ────────────────
    _httpGet(path) {
        return new Promise((resolve, reject) => {
            const url = new URL(path, this.serverUrl);
            http_1.default
                .get(url.toString(), (res) => {
                let data = "";
                res.on("data", (chunk) => (data += chunk));
                res.on("end", () => {
                    try {
                        resolve(JSON.parse(data));
                    }
                    catch {
                        reject(new Error(`Invalid JSON response from server: ${data}`));
                    }
                });
            })
                .on("error", (err) => reject(new Error(`Cannot reach AirSign server: ${err.message}`)));
        });
    }
    _httpPost(path, body, timeout = 30000) {
        return new Promise((resolve, reject) => {
            const url = new URL(path, this.serverUrl);
            const data = JSON.stringify(body);
            const req = http_1.default.request({
                hostname: url.hostname,
                port: url.port,
                path: url.pathname,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(data),
                },
                timeout,
            }, (res) => {
                let resData = "";
                res.on("data", (chunk) => (resData += chunk));
                res.on("end", () => {
                    try {
                        resolve(JSON.parse(resData));
                    }
                    catch {
                        reject(new Error(`Invalid JSON response from server: ${resData}`));
                    }
                });
            });
            req.on("error", (err) => reject(new Error(`Cannot reach AirSign server: ${err.message}`)));
            req.on("timeout", () => {
                req.destroy();
                reject(new Error("Request to AirSign server timed out"));
            });
            req.write(data);
            req.end();
        });
    }
}
exports.SigningClient = SigningClient;
//# sourceMappingURL=SigningClient.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SigningServer = exports.SigningClient = exports.RemoteSigner = void 0;
const config_1 = require("hardhat/config");
const ethers_1 = require("ethers");
const RemoteSigner_1 = require("./RemoteSigner");
const SigningClient_1 = require("./SigningClient");
require("./types");
// Import tasks
require("./tasks/start");
require("./tasks/stop");
require("./tasks/status");
// ─── Default Config ──────────────────────────────────────────────
const DEFAULT_CONFIG = {
    port: 9090,
    host: "0.0.0.0",
    sessionTimeout: 24 * 60 * 60 * 1000, // 24 hours
    appPath: "",
};
// ─── Extend Hardhat Config ──────────────────────────────────────
(0, config_1.extendConfig)((config, userConfig) => {
    const userRemoteSigner = userConfig.remoteSigner || {};
    config.remoteSigner = {
        port: userRemoteSigner.port ?? DEFAULT_CONFIG.port,
        host: userRemoteSigner.host ?? DEFAULT_CONFIG.host,
        sessionTimeout: userRemoteSigner.sessionTimeout ?? DEFAULT_CONFIG.sessionTimeout,
        appPath: userRemoteSigner.appPath ?? DEFAULT_CONFIG.appPath,
    };
});
// ─── Extend Hardhat Runtime Environment ─────────────────────────
let signerInstance = null;
/**
 * Core logic to get an AirSign RemoteSigner instance.
 * Shared between hre.remoteSigner.getSigner() and the getSigners() override.
 */
async function getAirSignSigner(hre) {
    if (signerInstance)
        return signerInstance;
    const networkConfig = hre.network.config;
    const port = hre.config.remoteSigner.port;
    const client = new SigningClient_1.SigningClient(port);
    // 1. Check if the AirSign server is running
    const running = await client.isServerRunning();
    if (!running) {
        throw new Error(`AirSign server is not running on port ${port}.\n` +
            `  Start it first:\n\n` +
            `    npx hardhat airsign-start\n\n` +
            `  Then run your deploy script again.`);
    }
    // 2. Check if a wallet is connected, wait if not
    console.log(`\n  🔐 Connected to AirSign server on port ${port}`);
    let signerAddress = await client.getWalletAddress();
    if (!signerAddress) {
        console.log("  ⏳ Waiting for wallet connection on AirSign UI...");
        signerAddress = await client.waitForWallet(120000);
    }
    console.log(`  ✅ Signer ready: ${signerAddress}\n`);
    // 3. Create provider from network config
    const rpcUrl = networkConfig.url || "http://127.0.0.1:8545";
    const provider = new ethers_1.ethers.providers.JsonRpcProvider(rpcUrl);
    // 4. Create RemoteSigner with the HTTP client as transport
    signerInstance = new RemoteSigner_1.RemoteSigner(client, provider, signerAddress);
    return signerInstance;
}
(0, config_1.extendEnvironment)((hre) => {
    // ─── Override hre.ethers.getSigners() ────────────────────────
    //
    // When `remoteSigner: true` is set on the active network config,
    // getSigners() returns the AirSign RemoteSigner instead of the
    // default private-key signers. This makes AirSign a drop-in —
    // existing deploy scripts work without any code changes.
    //
    // When remoteSigner is NOT set, the original getSigners() runs
    // as normal (private keys from `accounts` in config).
    // hre.ethers is added by @nomiclabs/hardhat-ethers (not typed here)
    const hreAny = hre;
    const originalGetSigners = hreAny.ethers?.getSigners?.bind(hreAny.ethers);
    if (hreAny.ethers && originalGetSigners) {
        hreAny.ethers.getSigners = async () => {
            const networkConfig = hre.network.config;
            if (!networkConfig.remoteSigner) {
                // Not using AirSign — fall through to original behavior
                return originalGetSigners();
            }
            // AirSign mode — return the remote signer
            const remoteSigner = await getAirSignSigner(hre);
            return [remoteSigner];
        };
    }
    // ─── hre.remoteSigner (advanced API / fallback) ──────────────
    hre.remoteSigner = {
        /**
         * Get a RemoteSigner instance directly.
         * Use this if you need explicit control, or if you're not using
         * @nomiclabs/hardhat-ethers (which provides hre.ethers.getSigners).
         */
        getSigner: async () => {
            const networkConfig = hre.network.config;
            if (!networkConfig.remoteSigner) {
                throw new Error(`Remote signer is not enabled for network "${hre.network.name}". ` +
                    `Add \`remoteSigner: true\` to your network config in hardhat.config.js`);
            }
            return getAirSignSigner(hre);
        },
        /**
         * Get the server port (for informational purposes).
         */
        getServer: () => {
            throw new Error("Direct server access is not available from deploy scripts.\n" +
                "The server runs as a separate process (airsign-start).\n" +
                "Use `hre.ethers.getSigners()` or `remoteSigner.getSigner()` to get a signer.");
        },
    };
});
// ─── Exports ────────────────────────────────────────────────────
var RemoteSigner_2 = require("./RemoteSigner");
Object.defineProperty(exports, "RemoteSigner", { enumerable: true, get: function () { return RemoteSigner_2.RemoteSigner; } });
var SigningClient_2 = require("./SigningClient");
Object.defineProperty(exports, "SigningClient", { enumerable: true, get: function () { return SigningClient_2.SigningClient; } });
var SigningServer_1 = require("./SigningServer");
Object.defineProperty(exports, "SigningServer", { enumerable: true, get: function () { return SigningServer_1.SigningServer; } });
//# sourceMappingURL=index.js.map
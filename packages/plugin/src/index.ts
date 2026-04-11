import { extendConfig, extendEnvironment } from "hardhat/config";
import { HardhatConfig, HardhatUserConfig } from "hardhat/types";
import { ethers } from "ethers";
import { RemoteSigner } from "./RemoteSigner";
import { SigningClient } from "./SigningClient";
import "./types";

// Import tasks
import "./tasks/start";
import "./tasks/stop";
import "./tasks/status";

// ─── Default Config ──────────────────────────────────────────────

const DEFAULT_CONFIG = {
  port: 9090,
  host: "0.0.0.0",
  sessionTimeout: 24 * 60 * 60 * 1000, // 24 hours
  appPath: "",
};

// ─── Extend Hardhat Config ──────────────────────────────────────

extendConfig(
  (config: HardhatConfig, userConfig: Readonly<HardhatUserConfig>) => {
    const userRemoteSigner = userConfig.remoteSigner || {};
    config.remoteSigner = {
      port: userRemoteSigner.port ?? DEFAULT_CONFIG.port,
      host: userRemoteSigner.host ?? DEFAULT_CONFIG.host,
      sessionTimeout:
        userRemoteSigner.sessionTimeout ?? DEFAULT_CONFIG.sessionTimeout,
      appPath: userRemoteSigner.appPath ?? DEFAULT_CONFIG.appPath,
    };
  }
);

// ─── Extend Hardhat Runtime Environment ─────────────────────────

let signerInstance: RemoteSigner | null = null;

/**
 * Core logic to get an AirSign RemoteSigner instance.
 * Shared between hre.remoteSigner.getSigner() and the getSigners() override.
 */
async function getAirSignSigner(hre: any): Promise<RemoteSigner> {
  if (signerInstance) return signerInstance;

  const networkConfig = hre.network.config as any;
  const port = hre.config.remoteSigner.port;
  const client = new SigningClient(port);

  // 1. Check if the AirSign server is running
  const running = await client.isServerRunning();
  if (!running) {
    throw new Error(
      `AirSign server is not running on port ${port}.\n` +
        `  Start it first:\n\n` +
        `    npx hardhat airsign-start\n\n` +
        `  Then run your deploy script again.`
    );
  }

  // 2. Check if a wallet is connected, wait if not
  console.log(`\n  🔐 Connected to AirSign server on port ${port}`);

  let signerAddress = await client.getWalletAddress();
  if (!signerAddress) {
    console.log("  ⏳ Waiting for wallet connection on AirSign UI...");
    signerAddress = await client.waitForWallet(120_000);
  }
  console.log(`  ✅ Signer ready: ${signerAddress}\n`);

  // 3. Create provider from network config.
  //    If no explicit URL is set, use the AirSign RPC proxy which
  //    relays JSON-RPC calls through the connected browser wallet.
  //    This means users don't need to configure Alchemy/Infura URLs
  //    — MetaMask's built-in provider handles RPC.
  const explicitUrl = (networkConfig as any).url;
  const rpcUrl = explicitUrl || `http://127.0.0.1:${port}/api/rpc`;

  if (!explicitUrl) {
    console.log(`  📡 No RPC URL configured — using wallet-proxied RPC via AirSign`);
  }

  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

  // 4. Create RemoteSigner with the HTTP client as transport
  signerInstance = new RemoteSigner(client, provider, signerAddress);
  return signerInstance;
}

extendEnvironment((hre) => {
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
  const hreAny = hre as any;
  const originalGetSigners = hreAny.ethers?.getSigners?.bind(hreAny.ethers);

  if (hreAny.ethers && originalGetSigners) {
    hreAny.ethers.getSigners = async (): Promise<any[]> => {
      const networkConfig = hre.network.config as any;

      if (!networkConfig.remoteSigner) {
        // Not using AirSign — fall through to original behavior
        return originalGetSigners();
      }

      // AirSign mode — return the remote signer
      const remoteSigner = await getAirSignSigner(hre);
      return [remoteSigner] as any[];
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
      const networkConfig = hre.network.config as any;

      if (!networkConfig.remoteSigner) {
        throw new Error(
          `Remote signer is not enabled for network "${hre.network.name}". ` +
            `Add \`remoteSigner: true\` to your network config in hardhat.config.js`
        );
      }

      return getAirSignSigner(hre);
    },

    /**
     * Get the server port (for informational purposes).
     */
    getServer: () => {
      throw new Error(
        "Direct server access is not available from deploy scripts.\n" +
          "The server runs as a separate process (airsign-start).\n" +
          "Use `hre.ethers.getSigners()` or `remoteSigner.getSigner()` to get a signer."
      );
    },
  };
});

// ─── Exports ────────────────────────────────────────────────────

export { RemoteSigner } from "./RemoteSigner";
export { SigningClient } from "./SigningClient";
export { SigningServer } from "./SigningServer";
export { ContractService } from "./ContractService";
export type { RemoteSignerConfig, SigningRequest, SigningResponse } from "./types";
export type {
  ContractInfo,
  ABIFunction,
  ABIEvent,
  ABIParam,
  DecodedEvent,
} from "./ContractService";

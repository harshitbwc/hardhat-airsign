import { BigNumberish } from "ethers";

// ─── Plugin Configuration ────────────────────────────────────────────

export interface RemoteSignerConfig {
  /** Port for the signing server (default: 9090) */
  port?: number;
  /** Host to bind the server (default: "0.0.0.0") */
  host?: string;
  /** Session timeout in ms (default: 24 hours) */
  sessionTimeout?: number;
  /** Path to serve the signing app from (auto-resolved if not set) */
  appPath?: string;
}

// ─── Network Extension ──────────────────────────────────────────────

declare module "hardhat/types/config" {
  interface HardhatNetworkUserConfig {
    remoteSigner?: boolean;
  }
  interface HttpNetworkUserConfig {
    remoteSigner?: boolean;
  }
  interface HardhatNetworkConfig {
    remoteSigner?: boolean;
  }
  interface HttpNetworkConfig {
    remoteSigner?: boolean;
  }
  interface HardhatUserConfig {
    remoteSigner?: RemoteSignerConfig;
  }
  interface HardhatConfig {
    remoteSigner: Required<RemoteSignerConfig>;
  }
}

declare module "hardhat/types/runtime" {
  interface HardhatRuntimeEnvironment {
    remoteSigner: {
      getSigner: () => Promise<import("ethers").Signer>;
      getServer: () => import("./SigningServer").SigningServer;
    };
  }
}

// ─── Socket.io Event Types ──────────────────────────────────────────

export interface SignerConnectedPayload {
  address: string;
  chainId: number;
}

export interface SignTransactionRequest {
  id: string;
  type: "sendTransaction";
  transaction: {
    to?: string;
    from?: string;
    data?: string;
    value?: string;
    gasLimit?: string;
    gasPrice?: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
    nonce?: number;
    chainId?: number;
  };
  metadata?: {
    contractName?: string;
    functionName?: string;
    description?: string;
  };
}

export interface SignMessageRequest {
  id: string;
  type: "signMessage";
  message: string;
}

export interface SignTypedDataRequest {
  id: string;
  type: "signTypedData";
  domain: Record<string, any>;
  types: Record<string, any>;
  value: Record<string, any>;
}

export type SigningRequest =
  | SignTransactionRequest
  | SignMessageRequest
  | SignTypedDataRequest;

export interface SigningResponse {
  id: string;
  success: boolean;
  result?: string; // tx hash for sendTransaction, signature for signMessage
  error?: string;
}

export interface SessionInfo {
  sessionId: string;
  port: number;
  signerAddress?: string;
  signerChainId?: number;
  createdAt: number;
}

// ─── Signing Transport Interface ────────────────────────────────────
// Both SigningServer (in-process) and SigningClient (HTTP) implement this.

export interface SigningTransport {
  sendSigningRequest(
    request: SigningRequest,
    callback: (response: SigningResponse) => void
  ): void;
}

// ─── Socket.io Event Map ────────────────────────────────────────────

export interface ServerToClientEvents {
  "signing:request": (request: SigningRequest) => void;
  "signing:requestWalletState": () => void;
  "session:info": (info: { sessionId: string }) => void;
}

export interface ClientToServerEvents {
  "signer:connected": (payload: SignerConnectedPayload) => void;
  "signer:disconnected": () => void;
  "signing:response": (response: SigningResponse) => void;
  "signer:chainChanged": (chainId: number) => void;
  "signer:accountChanged": (address: string) => void;
}

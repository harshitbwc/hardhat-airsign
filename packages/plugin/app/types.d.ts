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
export type SigningRequest = SignTransactionRequest | SignMessageRequest | SignTypedDataRequest;
export interface SigningResponse {
    id: string;
    success: boolean;
    result?: string;
    error?: string;
}
export interface SessionInfo {
    sessionId: string;
    port: number;
    signerAddress?: string;
    signerChainId?: number;
    createdAt: number;
}
export interface SigningTransport {
    sendSigningRequest(request: SigningRequest, callback: (response: SigningResponse) => void): void;
}
export interface TaskParamInfo {
    name: string;
    description?: string;
    defaultValue?: string;
    isOptional: boolean;
    isFlag: boolean;
}
export interface TaskInfo {
    name: string;
    description: string;
    params: TaskParamInfo[];
    isSubtask: boolean;
}
export interface ScriptInfo {
    name: string;
    path: string;
}
export interface NetworkInfo {
    name: string;
    chainId?: number;
    url?: string;
    remoteSigner?: boolean;
}
export interface ProjectContext {
    projectRoot: string;
    tasks: TaskInfo[];
    networks: NetworkInfo[];
}
export interface ProcessStartedPayload {
    processId: string;
    type: "script" | "task";
    name: string;
    network?: string;
}
export interface ProcessOutputPayload {
    processId: string;
    stream: "stdout" | "stderr";
    data: string;
}
export interface ProcessExitPayload {
    processId: string;
    code: number;
    signal?: string;
}
export interface ServerToClientEvents {
    "signing:request": (request: SigningRequest) => void;
    "signing:requestWalletState": () => void;
    "session:info": (info: {
        sessionId: string;
    }) => void;
    "process:started": (payload: ProcessStartedPayload) => void;
    "process:output": (payload: ProcessOutputPayload) => void;
    "process:exit": (payload: ProcessExitPayload) => void;
}
export interface ClientToServerEvents {
    "signer:connected": (payload: SignerConnectedPayload) => void;
    "signer:disconnected": () => void;
    "signing:response": (response: SigningResponse) => void;
    "signer:chainChanged": (chainId: number) => void;
    "signer:accountChanged": (address: string) => void;
}
//# sourceMappingURL=types.d.ts.map
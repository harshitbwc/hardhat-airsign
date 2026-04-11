/**
 * Shared types between plugin and signing app.
 * These mirror the types in packages/plugin/src/types.ts.
 *
 * IMPORTANT: Keep in sync with packages/plugin/src/types.ts
 * A mismatch here will cause signing to fail silently.
 */

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

// ─── Runner Types ──────────────────────────────────────────────────

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

// ─── Contract Interaction Types ───────────────────────────────────

export interface ABIParam {
  name: string;
  type: string;
  components?: ABIParam[];
  indexed?: boolean;
  internalType?: string;
}

export interface ABIFunction {
  name: string;
  signature: string;
  stateMutability: "view" | "pure" | "nonpayable" | "payable";
  inputs: ABIParam[];
  outputs: ABIParam[];
  payable: boolean;
}

export interface ABIEvent {
  name: string;
  signature: string;
  inputs: ABIParam[];
}

export interface ContractInfo {
  contractName: string;
  sourceName: string;
  abi: any[];
  functions: {
    read: ABIFunction[];
    write: ABIFunction[];
  };
  events: ABIEvent[];
  deployedAddresses: Record<string, string>;
}

export interface DecodedEvent {
  name: string;
  signature: string;
  args: Record<string, any>;
  logIndex: number;
  address: string;
}

export interface ReadCallResult {
  success: boolean;
  result?: any;
  error?: string;
}

export interface EventsResult {
  success: boolean;
  events?: DecodedEvent[];
  error?: string;
}

export interface ProxyCheckResult {
  isProxy: boolean;
  implementationAddress?: string;
  adminAddress?: string;
  matchedContract?: string;
}

export interface ActivityLogEntry {
  id: string;
  timestamp: number;
  type: "read" | "write" | "event" | "error";
  contractName: string;
  functionName: string;
  args?: any[];
  result?: any;
  txHash?: string;
  error?: string;
}

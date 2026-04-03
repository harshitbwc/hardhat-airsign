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

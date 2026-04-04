import { ethers } from "ethers";
import { SigningTransport } from "./types";
/**
 * RemoteSigner — a custom ethers.js Signer that delegates all signing
 * to a remote browser wallet via the AirSign server.
 *
 * Works with any SigningTransport (SigningClient for HTTP, or
 * SigningServer for in-process use).
 */
export declare class RemoteSigner extends ethers.Signer {
    private _address;
    private _transport;
    private _requestTimeout;
    constructor(transport: SigningTransport, provider: ethers.providers.Provider, address: string, requestTimeout?: number);
    getAddress(): Promise<string>;
    signMessage(message: string | ethers.utils.Bytes): Promise<string>;
    signTransaction(_transaction: ethers.utils.Deferrable<ethers.providers.TransactionRequest>): Promise<string>;
    sendTransaction(transaction: ethers.utils.Deferrable<ethers.providers.TransactionRequest>): Promise<ethers.providers.TransactionResponse>;
    connect(provider: ethers.providers.Provider): RemoteSigner;
    private _generateId;
    private _sendRequest;
    /**
     * Update the signer address (called when wallet is switched).
     */
    updateAddress(newAddress: string): void;
}
//# sourceMappingURL=RemoteSigner.d.ts.map
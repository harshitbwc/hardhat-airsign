import { ethers } from "ethers";
import {
  SigningRequest,
  SigningResponse,
  SignTransactionRequest,
  SignMessageRequest,
  SigningTransport,
} from "./types";

/**
 * RemoteSigner — a custom ethers.js Signer that delegates all signing
 * to a remote browser wallet via the AirSign server.
 *
 * Works with any SigningTransport (SigningClient for HTTP, or
 * SigningServer for in-process use).
 */
export class RemoteSigner extends ethers.Signer {
  private _address: string;
  private _transport: SigningTransport;
  private _requestTimeout: number;

  constructor(
    transport: SigningTransport,
    provider: ethers.providers.Provider,
    address: string,
    requestTimeout: number = 300_000 // 5 min — matches server long-poll timeout
  ) {
    super();
    ethers.utils.defineReadOnly(this, "provider", provider);
    this._transport = transport;
    this._address = address;
    this._requestTimeout = requestTimeout;
  }

  // ─── Core Signer Methods ────────────────────────────────────────

  async getAddress(): Promise<string> {
    return this._address;
  }

  async signMessage(message: string | ethers.utils.Bytes): Promise<string> {
    const msgString =
      typeof message === "string"
        ? message
        : ethers.utils.hexlify(message);

    const request: SignMessageRequest = {
      id: this._generateId(),
      type: "signMessage",
      message: msgString,
    };

    console.log(`  📨 Signing request sent (signMessage). Waiting for approval...`);
    const response = await this._sendRequest(request);

    if (!response.success || !response.result) {
      throw new Error(
        `Remote signing failed: ${response.error || "Unknown error"}`
      );
    }

    console.log(`  ✅ Message signed.`);
    return response.result;
  }

  async signTransaction(
    _transaction: ethers.utils.Deferrable<ethers.providers.TransactionRequest>
  ): Promise<string> {
    throw new Error(
      "signTransaction is not supported by most browser wallets. " +
      "Use sendTransaction instead, which signs and broadcasts in one step."
    );
  }

  async sendTransaction(
    transaction: ethers.utils.Deferrable<ethers.providers.TransactionRequest>
  ): Promise<ethers.providers.TransactionResponse> {
    this._checkProvider("sendTransaction");

    // Resolve all deferrable fields
    const tx = await ethers.utils.resolveProperties(transaction);

    // Send only essential fields — MetaMask handles gas/nonce
    const request: SignTransactionRequest = {
      id: this._generateId(),
      type: "sendTransaction",
      transaction: {
        to: tx.to,
        from: this._address,
        data: tx.data ? ethers.utils.hexlify(tx.data) : undefined,
        value: tx.value
          ? ethers.BigNumber.from(tx.value).toHexString()
          : "0x0",
        gasLimit: tx.gasLimit
          ? ethers.BigNumber.from(tx.gasLimit).toHexString()
          : undefined,
        chainId: tx.chainId,
      },
    };

    console.log(`  📨 Transaction sent to signer. Waiting for approval in wallet...`);
    const response = await this._sendRequest(request);

    if (!response.success || !response.result) {
      throw new Error(
        `Remote transaction failed: ${response.error || "Unknown error"}`
      );
    }

    const txHash = response.result;
    console.log(`  ✅ Transaction signed! Hash: ${txHash}`);

    // Wait for on-chain confirmation via provider
    console.log(`  ⏳ Waiting for transaction on-chain...`);
    const receipt = await this.provider!.waitForTransaction(txHash, 1, 60_000);
    console.log(`  ✅ Transaction confirmed in block ${receipt.blockNumber}`);

    const txResponse = await this.provider!.getTransaction(txHash);
    return txResponse;
  }

  connect(provider: ethers.providers.Provider): RemoteSigner {
    return new RemoteSigner(this._transport, provider, this._address, this._requestTimeout);
  }

  // ─── Internal Helpers ───────────────────────────────────────────

  private _generateId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async _sendRequest(
    request: SigningRequest
  ): Promise<SigningResponse> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new Error(
            `Signing request timed out after ${this._requestTimeout / 1000}s. ` +
            `Make sure the signer has the browser tab open and wallet connected.`
          )
        );
      }, this._requestTimeout);

      this._transport.sendSigningRequest(request, (response) => {
        clearTimeout(timeout);
        resolve(response);
      });
    });
  }

  /**
   * Update the signer address (called when wallet is switched).
   */
  updateAddress(newAddress: string): void {
    this._address = newAddress;
  }
}

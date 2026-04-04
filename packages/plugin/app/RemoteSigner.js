"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RemoteSigner = void 0;
const ethers_1 = require("ethers");
/**
 * RemoteSigner — a custom ethers.js Signer that delegates all signing
 * to a remote browser wallet via the AirSign server.
 *
 * Works with any SigningTransport (SigningClient for HTTP, or
 * SigningServer for in-process use).
 */
class RemoteSigner extends ethers_1.ethers.Signer {
    constructor(transport, provider, address, requestTimeout = 300000 // 5 min — matches server long-poll timeout
    ) {
        super();
        ethers_1.ethers.utils.defineReadOnly(this, "provider", provider);
        this._transport = transport;
        this._address = address;
        this._requestTimeout = requestTimeout;
    }
    // ─── Core Signer Methods ────────────────────────────────────────
    async getAddress() {
        return this._address;
    }
    async signMessage(message) {
        const msgString = typeof message === "string"
            ? message
            : ethers_1.ethers.utils.hexlify(message);
        const request = {
            id: this._generateId(),
            type: "signMessage",
            message: msgString,
        };
        console.log(`  📨 Signing request sent (signMessage). Waiting for approval...`);
        const response = await this._sendRequest(request);
        if (!response.success || !response.result) {
            throw new Error(`Remote signing failed: ${response.error || "Unknown error"}`);
        }
        console.log(`  ✅ Message signed.`);
        return response.result;
    }
    async signTransaction(_transaction) {
        throw new Error("signTransaction is not supported by most browser wallets. " +
            "Use sendTransaction instead, which signs and broadcasts in one step.");
    }
    async sendTransaction(transaction) {
        this._checkProvider("sendTransaction");
        // Resolve all deferrable fields
        const tx = await ethers_1.ethers.utils.resolveProperties(transaction);
        // Send only essential fields — MetaMask handles gas/nonce
        const request = {
            id: this._generateId(),
            type: "sendTransaction",
            transaction: {
                to: tx.to,
                from: this._address,
                data: tx.data ? ethers_1.ethers.utils.hexlify(tx.data) : undefined,
                value: tx.value
                    ? ethers_1.ethers.BigNumber.from(tx.value).toHexString()
                    : "0x0",
                gasLimit: tx.gasLimit
                    ? ethers_1.ethers.BigNumber.from(tx.gasLimit).toHexString()
                    : undefined,
                chainId: tx.chainId,
            },
        };
        console.log(`  📨 Transaction sent to signer. Waiting for approval in wallet...`);
        const response = await this._sendRequest(request);
        if (!response.success || !response.result) {
            throw new Error(`Remote transaction failed: ${response.error || "Unknown error"}`);
        }
        const txHash = response.result;
        console.log(`  ✅ Transaction signed! Hash: ${txHash}`);
        // Wait for on-chain confirmation via provider
        console.log(`  ⏳ Waiting for transaction on-chain...`);
        const receipt = await this.provider.waitForTransaction(txHash, 1, 60000);
        console.log(`  ✅ Transaction confirmed in block ${receipt.blockNumber}`);
        const txResponse = await this.provider.getTransaction(txHash);
        return txResponse;
    }
    connect(provider) {
        return new RemoteSigner(this._transport, provider, this._address, this._requestTimeout);
    }
    // ─── Internal Helpers ───────────────────────────────────────────
    _generateId() {
        return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    async _sendRequest(request) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error(`Signing request timed out after ${this._requestTimeout / 1000}s. ` +
                    `Make sure the signer has the browser tab open and wallet connected.`));
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
    updateAddress(newAddress) {
        this._address = newAddress;
    }
}
exports.RemoteSigner = RemoteSigner;
//# sourceMappingURL=RemoteSigner.js.map
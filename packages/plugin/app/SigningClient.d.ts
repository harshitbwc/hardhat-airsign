import { SigningRequest, SigningResponse } from "./types";
/**
 * SigningClient — an HTTP client that deploy scripts use to talk to the
 * already-running AirSign server (started via `airsign-start`).
 *
 * Uses plain Node.js `http` module — no extra dependencies.
 * The server holds the HTTP connection open for `/api/sign` until
 * the browser wallet responds (long-polling).
 */
export declare class SigningClient {
    private serverUrl;
    constructor(port?: number, host?: string);
    /**
     * Check if the AirSign server is running.
     */
    isServerRunning(): Promise<boolean>;
    /**
     * Get the currently connected wallet address.
     * Returns null if no wallet is connected.
     */
    getWalletAddress(): Promise<string | null>;
    /**
     * Wait until a wallet is connected on the AirSign UI.
     * Polls /api/wallet every `interval` ms until an address appears or timeout.
     */
    waitForWallet(timeout?: number, interval?: number): Promise<string>;
    /**
     * Send a signing request to the server.
     * The server forwards it to the browser wallet and holds the connection
     * open until the wallet responds (long-polling, up to 5 min).
     */
    sendSigningRequest(request: SigningRequest, callback: (response: SigningResponse) => void): void;
    private _httpGet;
    private _httpPost;
}
//# sourceMappingURL=SigningClient.d.ts.map
import { SigningRequest, SigningResponse, SessionInfo, ProjectContext } from "./types";
/**
 * SigningServer — an Express + Socket.io server that:
 * 1. Serves the signing web app (React UI)
 * 2. Manages the WebSocket connection between plugin and signing app
 * 3. Routes signing requests from Hardhat → browser and responses back
 */
export declare class SigningServer {
    private app;
    private httpServer;
    private io;
    private signerSocket;
    private sessionInfo;
    private pendingCallbacks;
    private pendingTimeouts;
    private signerConnectedPromise;
    private signerConnectedResolve;
    private isSignerConnected;
    private _onAccountChanged;
    private projectContext;
    private runningProcess;
    private runningProcessId;
    constructor(port?: number, host?: string, appPath?: string, projectContext?: ProjectContext);
    start(): Promise<SessionInfo>;
    stop(): Promise<void>;
    getSessionInfo(): SessionInfo;
    /**
     * Wait for a signer to connect from the browser.
     * Returns the signer's wallet address.
     */
    waitForSigner(): Promise<string>;
    /**
     * Register a callback for when the wallet account changes.
     */
    onAccountChanged(callback: (address: string) => void): void;
    /**
     * Send a signing request to the connected browser wallet.
     * Calls the callback when the signer responds.
     */
    sendSigningRequest(request: SigningRequest, callback: (response: SigningResponse) => void): void;
    private setupSocketHandlers;
    /**
     * Clear a pending callback and its associated timeout.
     */
    private clearPendingCallback;
    /**
     * Reject all pending signing requests with an error message.
     */
    private rejectAllPending;
    /**
     * Scan the project's scripts/ directory for .js and .ts files.
     */
    private discoverScripts;
    /**
     * Execute a Hardhat script or task as a child process.
     * Streams stdout/stderr to all connected socket.io clients.
     */
    private executeProcess;
    /**
     * Kill the currently running process.
     */
    private killRunningProcess;
    private generateSessionId;
    /**
     * Try to find the pre-built signing app in multiple locations.
     * Returns the path if found, null otherwise.
     */
    private resolveAppPath;
}
//# sourceMappingURL=SigningServer.d.ts.map
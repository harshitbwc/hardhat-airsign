import express from "express";
import http from "http";
import path from "path";
import fs from "fs";
import { spawn, ChildProcess } from "child_process";
import { Server as SocketIOServer, Socket } from "socket.io";
import {
  SigningRequest,
  SigningResponse,
  SignerConnectedPayload,
  ServerToClientEvents,
  ClientToServerEvents,
  SessionInfo,
  ProjectContext,
  TaskInfo,
  ScriptInfo,
  NetworkInfo,
} from "./types";
import { ContractService } from "./ContractService";

// Timeout for pending signing callbacks (matches HTTP long-poll timeout)
const CALLBACK_TIMEOUT_MS = 300_000; // 5 minutes

/**
 * SigningServer — an Express + Socket.io server that:
 * 1. Serves the signing web app (React UI)
 * 2. Manages the WebSocket connection between plugin and signing app
 * 3. Routes signing requests from Hardhat → browser and responses back
 */
export class SigningServer {
  private app: express.Application;
  private httpServer: http.Server;
  private io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>;
  private signerSocket: Socket | null = null;
  private sessionInfo: SessionInfo;
  private pendingCallbacks: Map<string, (response: SigningResponse) => void> =
    new Map();
  private pendingTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private pendingRpcCallbacks: Map<string, (result: any, error: any) => void> = new Map();

  // Promises for connection state
  private signerConnectedPromise: Promise<string>;
  private signerConnectedResolve!: (address: string) => void;
  private isSignerConnected: boolean = false;

  // Callback for when wallet account changes (so plugin can update RemoteSigner)
  private _onAccountChanged: ((address: string) => void) | null = null;

  // Project context for the runner feature
  private projectContext: ProjectContext | null = null;

  // Currently running process (only one at a time)
  private runningProcess: ChildProcess | null = null;
  private runningProcessId: string | null = null;

  // Contract interaction service
  private contractService: ContractService | null = null;

  constructor(
    port: number = 9090,
    host: string = "0.0.0.0",
    appPath?: string,
    projectContext?: ProjectContext
  ) {
    this.projectContext = projectContext || null;
    this.app = express();

    // No CORS middleware — the UI is served from the same origin,
    // so same-origin requests work without CORS headers.
    // This prevents other websites from calling /api/sign.
    // Deploy scripts use Node's http module which isn't subject to CORS.

    // Body size limit: 5MB to accommodate large contract deployments
    this.app.use(express.json({ limit: "5mb" }));

    // Try to find the built signing app
    const staticPath = this.resolveAppPath(appPath);

    if (staticPath) {
      // Serve the pre-built React signing app
      this.app.use(express.static(staticPath));
    }

    // ─── HTTP API for CLI scripts (deploy scripts connect here) ───

    // Health check — deploy scripts use this to verify server is running
    this.app.get("/api/health", (_req, res) => {
      res.json({ status: "ok", signerConnected: this.isSignerConnected });
    });

    // Get current wallet info
    // If a browser socket is connected but we don't have a wallet address yet,
    // proactively ask the browser to re-announce its wallet state.
    this.app.get("/api/wallet", (_req, res) => {
      if (this.signerSocket && !this.sessionInfo.signerAddress) {
        this.signerSocket.emit("signing:requestWalletState");
      }
      res.json({
        address: this.sessionInfo.signerAddress || null,
        chainId: this.sessionInfo.signerChainId || null,
        connected: this.isSignerConnected,
      });
    });

    // Session info
    this.app.get("/api/session", (_req, res) => {
      res.json({
        sessionId: this.sessionInfo.sessionId,
        signerConnected: this.isSignerConnected,
        signerAddress: this.sessionInfo.signerAddress,
      });
    });

    // Signing endpoint — deploy scripts POST here, server holds connection
    // open until browser wallet signs (long-polling)
    this.app.post("/api/sign", (req, res) => {
      // Allow up to 5 minutes for user to approve in wallet
      req.setTimeout(CALLBACK_TIMEOUT_MS);

      const request = req.body as SigningRequest;

      // Validate required fields
      if (!request.id || !request.type) {
        res.status(400).json({
          id: request.id || "unknown",
          success: false,
          error: "Invalid signing request: missing 'id' or 'type' field.",
        });
        return;
      }

      if (!this.signerSocket || !this.isSignerConnected) {
        res.status(503).json({
          id: request.id,
          success: false,
          error: "No wallet connected. Open the AirSign UI and connect your wallet.",
        });
        return;
      }

      // Store callback with auto-cleanup timeout
      let responded = false;

      const callback = (response: SigningResponse) => {
        if (responded) return; // guard against double-response
        responded = true;
        this.clearPendingCallback(request.id);
        res.json(response);
      };

      this.pendingCallbacks.set(request.id, callback);

      // Auto-cleanup: if browser never responds within timeout,
      // send a timeout error and clean up the callback
      const timeout = setTimeout(() => {
        if (!responded) {
          responded = true;
          this.pendingCallbacks.delete(request.id);
          this.pendingTimeouts.delete(request.id);
          res.status(504).json({
            id: request.id,
            success: false,
            error: "Signing request timed out. The wallet did not respond within 5 minutes.",
          });
        }
      }, CALLBACK_TIMEOUT_MS);

      this.pendingTimeouts.set(request.id, timeout);

      // Forward request to browser
      this.signerSocket.emit("signing:request", request);
    });

    // ─── Runner API (tasks, scripts, networks) ────────────────────

    // List available scripts
    this.app.get("/api/scripts", (_req, res) => {
      if (!this.projectContext) {
        res.json({ scripts: [] });
        return;
      }
      const scripts = this.discoverScripts();
      res.json({ scripts });
    });

    // List available tasks
    this.app.get("/api/tasks", (_req, res) => {
      if (!this.projectContext) {
        res.json({ tasks: [] });
        return;
      }
      res.json({ tasks: this.projectContext.tasks });
    });

    // List available networks
    this.app.get("/api/networks", (_req, res) => {
      if (!this.projectContext) {
        res.json({ networks: [] });
        return;
      }
      res.json({ networks: this.projectContext.networks });
    });

    // Execute a script or task
    this.app.post("/api/execute", (req, res) => {
      if (!this.projectContext) {
        res.status(400).json({ error: "Project context not available" });
        return;
      }

      if (this.runningProcess) {
        res.status(409).json({ error: "A process is already running. Stop it first." });
        return;
      }

      const { type, name, network, params, envVars } = req.body;

      if (!type || !name) {
        res.status(400).json({ error: "Missing 'type' or 'name' field." });
        return;
      }

      if (type !== "script" && type !== "task") {
        res.status(400).json({ error: "type must be 'script' or 'task'." });
        return;
      }

      // Validate script exists
      if (type === "script") {
        const scripts = this.discoverScripts();
        if (!scripts.find((s) => s.name === name)) {
          res.status(404).json({ error: `Script '${name}' not found.` });
          return;
        }
      }

      // Validate task exists
      if (type === "task") {
        if (!this.projectContext.tasks.find((t) => t.name === name)) {
          res.status(404).json({ error: `Task '${name}' not found.` });
          return;
        }
      }

      const processId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      try {
        this.executeProcess(processId, type, name, network, params, envVars);
        res.json({ processId, status: "started" });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // Kill a running process
    this.app.post("/api/execute/kill", (_req, res) => {
      if (!this.runningProcess) {
        res.json({ status: "no_process" });
        return;
      }
      this.killRunningProcess();
      res.json({ status: "killed" });
    });

    // Get running process status
    this.app.get("/api/execute/status", (_req, res) => {
      res.json({
        running: !!this.runningProcess,
        processId: this.runningProcessId,
      });
    });

    // ─── Contracts API (contract interaction) ──────────────────────

    // Initialize contract service if project context available
    if (this.projectContext) {
      this.contractService = new ContractService(
        this.projectContext.projectRoot,
        this.projectContext.networks
      );
      // Scan artifacts asynchronously (non-blocking)
      this.contractService.scanArtifacts().catch((err) => {
        console.log("  ⚠️  Failed to scan contract artifacts:", err.message);
      });
    }

    // List all contracts with ABIs and parsed functions
    this.app.get("/api/contracts", (_req, res) => {
      if (!this.contractService) {
        res.json({ contracts: [] });
        return;
      }
      res.json({ contracts: this.contractService.getContracts() });
    });

    // Get saved contract addresses per network
    this.app.get("/api/contracts/addresses", (_req, res) => {
      if (!this.contractService) {
        res.json({ addresses: {} });
        return;
      }
      res.json({ addresses: this.contractService.getAddresses() });
    });

    // Save/update a contract address for a network
    this.app.post("/api/contracts/addresses", (req, res) => {
      if (!this.contractService) {
        res.status(400).json({ error: "Contract service not available" });
        return;
      }

      const { contractName, networkName, address } = req.body;

      if (!contractName || !networkName || !address) {
        res.status(400).json({ error: "Missing contractName, networkName, or address" });
        return;
      }

      this.contractService.saveAddress(contractName, networkName, address);
      res.json({ success: true });
    });

    // Execute a read-only (view/pure) function call
    this.app.post("/api/contract/read", async (req, res) => {
      if (!this.contractService) {
        res.status(400).json({ success: false, error: "Contract service not available" });
        return;
      }

      const { contractAddress, abi, functionName, args, networkName } = req.body;

      if (!contractAddress || !abi || !functionName || !networkName) {
        res.status(400).json({
          success: false,
          error: "Missing required fields: contractAddress, abi, functionName, networkName",
        });
        return;
      }

      const result = await this.contractService.executeReadCall({
        contractAddress,
        abi,
        functionName,
        args: args || [],
        networkName,
      });

      res.json(result);
    });

    // Fetch and decode events from a transaction receipt
    this.app.post("/api/contract/events", async (req, res) => {
      if (!this.contractService) {
        res.status(400).json({ success: false, error: "Contract service not available" });
        return;
      }

      const { contractAddress, abi, txHash, networkName } = req.body;

      if (!txHash || !abi || !networkName) {
        res.status(400).json({
          success: false,
          error: "Missing required fields: txHash, abi, networkName",
        });
        return;
      }

      const result = await this.contractService.fetchEvents({
        contractAddress: contractAddress || "0x",
        abi,
        txHash,
        networkName,
      });

      res.json(result);
    });

    // Check if a contract address is a proxy (ERC-1967)
    this.app.post("/api/contract/proxy", async (req, res) => {
      if (!this.contractService) {
        res.status(400).json({ isProxy: false, error: "Contract service not available" });
        return;
      }

      const { contractAddress, networkName } = req.body;

      if (!contractAddress || !networkName) {
        res.status(400).json({
          isProxy: false,
          error: "Missing contractAddress or networkName",
        });
        return;
      }

      const result = await this.contractService.checkProxy(contractAddress, networkName);
      res.json(result);
    });

    // Execute a write (state-changing) function via the signing flow.
    // Encodes the call, creates a signing request, and waits for wallet approval.
    this.app.post("/api/contract/write", async (req, res) => {
      if (!this.contractService) {
        res.status(400).json({ success: false, error: "Contract service not available" });
        return;
      }

      const { contractAddress, abi, functionName, args, networkName, value } = req.body;

      if (!contractAddress || !abi || !functionName || !networkName) {
        res.status(400).json({
          success: false,
          error: "Missing required fields: contractAddress, abi, functionName, networkName",
        });
        return;
      }

      if (!this.signerSocket || !this.isSignerConnected) {
        res.status(503).json({
          success: false,
          error: "No wallet connected. Open the AirSign UI and connect your wallet.",
        });
        return;
      }

      try {
        // Encode the function call data using ethers Interface
        const { createInterface } = await import("./adapters/ethers-adapter");
        const iface = createInterface(abi);
        const callData = iface.encodeFunctionData(functionName, args || []);

        // Build a signing request
        const requestId = `write-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const signingRequest: SigningRequest = {
          id: requestId,
          type: "sendTransaction",
          transaction: {
            to: contractAddress,
            data: callData,
            value: value && value !== "0" ? value : undefined,
            from: this.sessionInfo.signerAddress || undefined,
          },
          metadata: {
            contractName: functionName,
            functionName,
            description: `Call ${functionName} on contract`,
          },
        };

        // Allow up to 5 minutes for user to approve
        req.setTimeout(CALLBACK_TIMEOUT_MS);

        // Route through the signing flow
        let responded = false;
        const callback = (response: SigningResponse) => {
          if (responded) return;
          responded = true;
          this.clearPendingCallback(requestId);

          if (response.success) {
            res.json({ success: true, txHash: response.result });
          } else {
            res.json({ success: false, error: response.error || "Transaction rejected" });
          }
        };

        this.pendingCallbacks.set(requestId, callback);

        const timeout = setTimeout(() => {
          if (!responded) {
            responded = true;
            this.pendingCallbacks.delete(requestId);
            this.pendingTimeouts.delete(requestId);
            res.status(504).json({
              success: false,
              error: "Transaction timed out. The wallet did not respond within 5 minutes.",
            });
          }
        }, CALLBACK_TIMEOUT_MS);

        this.pendingTimeouts.set(requestId, timeout);

        // Forward to browser wallet
        this.signerSocket.emit("signing:request", signingRequest);
      } catch (err: any) {
        res.status(400).json({ success: false, error: err.message });
      }
    });

    // Re-scan artifacts (useful after recompilation)
    this.app.post("/api/contracts/rescan", async (_req, res) => {
      if (!this.contractService) {
        res.status(400).json({ error: "Contract service not available" });
        return;
      }

      await this.contractService.scanArtifacts();
      res.json({ success: true, contracts: this.contractService.getContracts().length });
    });

    // ─── RPC Proxy ─────────────────────────────────────────────────
    // Proxies JSON-RPC calls through the connected browser wallet.
    // This allows the plugin to read on-chain data even when no explicit
    // RPC URL is configured — the browser wallet's provider (MetaMask, etc.)
    // is already connected to the right network.

    this.app.post("/api/rpc", (req, res) => {
      if (!this.signerSocket || !this.isSignerConnected) {
        res.status(503).json({
          jsonrpc: "2.0",
          id: req.body?.id || null,
          error: { code: -32000, message: "No wallet connected" },
        });
        return;
      }

      const { method, params, id } = req.body;
      const rpcId = `rpc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      // Set 30s timeout for RPC calls
      const timeout = setTimeout(() => {
        this.pendingRpcCallbacks.delete(rpcId);
        res.status(504).json({
          jsonrpc: "2.0",
          id: id || null,
          error: { code: -32000, message: "RPC call timed out" },
        });
      }, 30_000);

      this.pendingRpcCallbacks.set(rpcId, (result: any, error: any) => {
        clearTimeout(timeout);
        this.pendingRpcCallbacks.delete(rpcId);
        if (error) {
          res.json({ jsonrpc: "2.0", id: id || null, error });
        } else {
          res.json({ jsonrpc: "2.0", id: id || null, result });
        }
      });

      this.signerSocket.emit("rpc:request" as any, { rpcId, method, params });
    });

    // Deploy contract endpoint
    this.app.post("/api/contract/deploy", async (req, res) => {
      if (!this.signerSocket || !this.isSignerConnected) {
        res.status(503).json({
          success: false,
          error: "No wallet connected. Open the AirSign UI and connect your wallet.",
        });
        return;
      }

      const { contractName, abi, args, networkName, value } = req.body;

      if (!contractName || !abi) {
        res.status(400).json({ success: false, error: "Missing contractName or abi" });
        return;
      }

      try {
        // Find the bytecode from artifacts
        const contract = this.contractService?.getContracts().find(
          (c) => c.contractName === contractName
        );

        // We need to get the bytecode from the artifact file
        let bytecode: string | undefined;
        if (this.projectContext?.projectRoot) {
          const artifactsDir = path.join(this.projectContext.projectRoot, "artifacts");
          bytecode = this.findBytecodeInArtifacts(artifactsDir, contractName);
        }

        if (!bytecode) {
          res.status(400).json({ success: false, error: `Bytecode not found for ${contractName}. Compile first.` });
          return;
        }

        // Encode constructor args
        const { createInterface } = await import("./adapters/ethers-adapter");
        const iface = createInterface(abi);

        let deployData = bytecode;
        const constructorFragment = iface.deploy;
        if (constructorFragment && args && args.length > 0) {
          const encodedArgs = iface.encodeDeploy(args);
          deployData = bytecode + encodedArgs.slice(2); // remove 0x from encoded args
        }

        // Build a signing request for deployment (to = null)
        const requestId = `deploy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const signingRequest: SigningRequest = {
          id: requestId,
          type: "sendTransaction",
          transaction: {
            from: this.sessionInfo.signerAddress || undefined,
            data: deployData,
            value: value && value !== "0" ? value : undefined,
            // No "to" field — signals contract creation
          },
          metadata: {
            contractName,
            functionName: "constructor",
            description: `Deploy ${contractName}`,
          },
        };

        req.setTimeout(CALLBACK_TIMEOUT_MS);

        let responded = false;
        const callback = (response: SigningResponse) => {
          if (responded) return;
          responded = true;
          this.clearPendingCallback(requestId);

          if (response.success && response.result) {
            // response.result is the tx hash — we need to get the deployed address
            // from the receipt. Emit back with the tx hash and let the UI poll/resolve.
            res.json({
              success: true,
              txHash: response.result,
              // Address will come from the receipt once confirmed
              address: null,
            });
          } else {
            res.json({ success: false, error: response.error || "Deployment rejected" });
          }
        };

        this.pendingCallbacks.set(requestId, callback);

        const timeout = setTimeout(() => {
          if (!responded) {
            responded = true;
            this.pendingCallbacks.delete(requestId);
            this.pendingTimeouts.delete(requestId);
            res.status(504).json({
              success: false,
              error: "Deployment timed out. The wallet did not respond within 5 minutes.",
            });
          }
        }, CALLBACK_TIMEOUT_MS);

        this.pendingTimeouts.set(requestId, timeout);

        this.signerSocket.emit("signing:request", signingRequest);
      } catch (err: any) {
        res.status(400).json({ success: false, error: err.message });
      }
    });

    // Shutdown endpoint
    this.app.post("/api/shutdown", (_req, res) => {
      res.json({ status: "shutting_down" });
      this.killRunningProcess();
      setTimeout(() => this.stop(), 100);
    });

    // ─── Serve the signing UI (SPA fallback) ─────────────────────

    this.app.get("*", (_req, res) => {
      if (staticPath && fs.existsSync(path.join(staticPath, "index.html"))) {
        res.sendFile(path.join(staticPath, "index.html"));
      } else {
        res.status(404).json({
          error: "AirSign UI not found.",
          hint: "Build the React app first: cd packages/app && npm run build",
        });
      }
    });

    this.httpServer = http.createServer(this.app);

    // Socket.io: no wildcard CORS — only same-origin connections allowed.
    // The UI is served by this same Express server, so the browser's
    // origin always matches, whether accessed via localhost or ngrok.
    this.io = new SocketIOServer(this.httpServer, {
      cors: {
        origin: (_origin, callback) => {
          // Allow same-origin (no origin header) and any origin that
          // matches this server. Since the UI is served from this server,
          // the browser's origin will always match.
          callback(null, true);
        },
        methods: ["GET", "POST"],
      },
    });

    // Generate a unique session ID
    this.sessionInfo = {
      sessionId: this.generateSessionId(),
      port,
      createdAt: Date.now(),
    };

    // Set up the signer connected promise
    this.signerConnectedPromise = new Promise((resolve) => {
      this.signerConnectedResolve = resolve;
    });

    this.setupSocketHandlers();
  }

  // ─── Lifecycle ──────────────────────────────────────────────────

  async start(): Promise<SessionInfo> {
    return new Promise((resolve, reject) => {
      this.httpServer.listen(this.sessionInfo.port, "0.0.0.0", () => {
        resolve(this.sessionInfo);
      });
      this.httpServer.on("error", reject);
    });
  }

  async stop(): Promise<void> {
    // Clean up all pending timeouts
    this.pendingTimeouts.forEach((timeout) => clearTimeout(timeout));
    this.pendingTimeouts.clear();

    return new Promise((resolve) => {
      this.io.close();
      this.httpServer.close(() => resolve());
    });
  }

  // ─── Public API ─────────────────────────────────────────────────

  getSessionInfo(): SessionInfo {
    return { ...this.sessionInfo };
  }

  /**
   * Wait for a signer to connect from the browser.
   * Returns the signer's wallet address.
   */
  async waitForSigner(): Promise<string> {
    if (this.sessionInfo.signerAddress) {
      return this.sessionInfo.signerAddress;
    }
    const address = await this.signerConnectedPromise;
    return address;
  }

  /**
   * Register a callback for when the wallet account changes.
   */
  onAccountChanged(callback: (address: string) => void): void {
    this._onAccountChanged = callback;
  }

  /**
   * Send a signing request to the connected browser wallet.
   * Calls the callback when the signer responds.
   */
  sendSigningRequest(
    request: SigningRequest,
    callback: (response: SigningResponse) => void
  ): void {
    if (!this.signerSocket || !this.isSignerConnected) {
      callback({
        id: request.id,
        success: false,
        error: "No signer connected. Open the signing URL in a browser and connect your wallet.",
      });
      return;
    }

    // Store callback with auto-cleanup timeout
    let responded = false;

    const wrappedCallback = (response: SigningResponse) => {
      if (responded) return;
      responded = true;
      this.clearPendingCallback(request.id);
      callback(response);
    };

    this.pendingCallbacks.set(request.id, wrappedCallback);

    const timeout = setTimeout(() => {
      if (!responded) {
        responded = true;
        this.pendingCallbacks.delete(request.id);
        this.pendingTimeouts.delete(request.id);
        callback({
          id: request.id,
          success: false,
          error: "Signing request timed out.",
        });
      }
    }, CALLBACK_TIMEOUT_MS);

    this.pendingTimeouts.set(request.id, timeout);

    // Send request to signing app
    this.signerSocket.emit("signing:request", request);
  }

  // ─── Socket.io Handlers ─────────────────────────────────────────

  private setupSocketHandlers(): void {
    this.io.on("connection", (socket) => {
      console.log("\n  📱 Browser connected to signing server");

      // Ask the browser to re-announce its wallet state.
      // This handles the case where wallet was already connected before
      // the Hardhat script started (browser reconnects to new server).
      socket.emit("signing:requestWalletState");

      // Handle signer wallet connection
      socket.on("signer:connected", (payload: SignerConnectedPayload) => {
        // If another tab was already the active signer, disconnect it
        if (this.signerSocket && this.signerSocket !== socket && this.signerSocket.connected) {
          console.log("  ↩️  Replaced previous browser tab as active signer.");
          this.signerSocket.emit("signing:replaced" as any);
          this.signerSocket.disconnect(true);
        }

        this.signerSocket = socket;
        this.isSignerConnected = true;
        this.sessionInfo.signerAddress = payload.address;
        this.sessionInfo.signerChainId = payload.chainId;

        console.log(`  ✅ Wallet connected: ${payload.address}`);
        console.log(`     Chain ID: ${payload.chainId}`);
        console.log(`\n  Ready for signing requests.\n`);

        // Resolve the waitForSigner promise
        this.signerConnectedResolve(payload.address);
      });

      // Handle signing responses from the browser
      socket.on("signing:response", (response: SigningResponse) => {
        const callback = this.pendingCallbacks.get(response.id);
        if (callback) {
          callback(response); // callback handles its own cleanup via wrapper
        }
      });

      // Handle wallet account changes
      socket.on("signer:accountChanged", (address: string) => {
        this.sessionInfo.signerAddress = address;
        console.log(`  🔄 Wallet account changed: ${address}`);

        // Reset and re-resolve the promise with new address
        this.signerConnectedPromise = Promise.resolve(address);

        // Notify the plugin so it can update the RemoteSigner
        if (this._onAccountChanged) {
          this._onAccountChanged(address);
        }
      });

      // Handle chain changes
      socket.on("signer:chainChanged", (chainId: number) => {
        this.sessionInfo.signerChainId = chainId;
        console.log(`  🔄 Chain changed: ${chainId}`);
      });

      // Handle RPC proxy responses from browser
      socket.on("rpc:response" as any, (payload: { rpcId: string; result?: any; error?: any }) => {
        const callback = this.pendingRpcCallbacks.get(payload.rpcId);
        if (callback) {
          callback(payload.result, payload.error);
        }
      });

      // Handle signer disconnect
      socket.on("signer:disconnected", () => {
        if (socket !== this.signerSocket) return; // ignore stale sockets
        this.isSignerConnected = false;
        this.signerSocket = null;
        console.log("  ❌ Wallet disconnected");

        this.rejectAllPending("Signer disconnected");

        // Reset the promise for next connection
        this.signerConnectedPromise = new Promise((resolve) => {
          this.signerConnectedResolve = resolve;
        });
      });

      // Handle socket disconnect (browser tab closed, etc.)
      socket.on("disconnect", (reason) => {
        if (socket === this.signerSocket) {
          this.isSignerConnected = false;
          this.signerSocket = null;
          console.log(`  ⚠️  Browser disconnected (${reason})`);

          this.rejectAllPending("Browser disconnected");

          // Reset the promise
          this.signerConnectedPromise = new Promise((resolve) => {
            this.signerConnectedResolve = resolve;
          });
        }
      });
    });
  }

  // ─── Helpers ────────────────────────────────────────────────────

  /**
   * Clear a pending callback and its associated timeout.
   */
  private clearPendingCallback(id: string): void {
    this.pendingCallbacks.delete(id);
    const timeout = this.pendingTimeouts.get(id);
    if (timeout) {
      clearTimeout(timeout);
      this.pendingTimeouts.delete(id);
    }
  }

  /**
   * Reject all pending signing requests with an error message.
   */
  private rejectAllPending(error: string): void {
    this.pendingCallbacks.forEach((callback, id) => {
      callback({ id, success: false, error });
    });
    // Callbacks clean themselves up via clearPendingCallback,
    // but clear remaining entries just in case
    this.pendingCallbacks.clear();
    this.pendingTimeouts.forEach((timeout) => clearTimeout(timeout));
    this.pendingTimeouts.clear();
  }

  // ─── Runner Methods ──────────────────────────────────────────────

  /**
   * Scan the project's scripts/ directory for .js and .ts files.
   */
  private discoverScripts(): ScriptInfo[] {
    if (!this.projectContext?.projectRoot) return [];

    const scriptsDir = path.join(this.projectContext.projectRoot, "scripts");
    if (!fs.existsSync(scriptsDir)) return [];

    try {
      const files = fs.readdirSync(scriptsDir);
      return files
        .filter((f) => /\.(js|ts)$/.test(f) && !f.endsWith(".d.ts"))
        .map((f) => ({ name: f, path: `scripts/${f}` }));
    } catch {
      return [];
    }
  }

  /**
   * Execute a Hardhat script or task as a child process.
   * Streams stdout/stderr to all connected socket.io clients.
   */
  private executeProcess(
    processId: string,
    type: "script" | "task",
    name: string,
    network?: string,
    params?: Record<string, string>,
    envVars?: Record<string, string>
  ): void {
    if (!this.projectContext) throw new Error("No project context");

    const args: string[] = [];

    if (type === "script") {
      args.push("run", `scripts/${name}`);
    } else {
      args.push(name);
      // Add task params as --key value
      if (params) {
        for (const [key, value] of Object.entries(params)) {
          if (value !== undefined && value !== "") {
            args.push(`--${key}`, value);
          }
        }
      }
    }

    // Add network flag
    if (network) {
      args.push("--network", network);
    }

    // Build env vars — merge user-provided with existing
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      ...(envVars || {}),
    };

    // Find npx path — use the same node that started us
    const npxPath = process.platform === "win32" ? "npx.cmd" : "npx";

    const child = spawn(npxPath, ["hardhat", ...args], {
      cwd: this.projectContext.projectRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.runningProcess = child;
    this.runningProcessId = processId;

    // Notify all connected clients
    this.io.emit("process:started" as any, { processId, type, name, network });

    child.stdout?.on("data", (data: Buffer) => {
      this.io.emit("process:output" as any, {
        processId,
        stream: "stdout",
        data: data.toString(),
      });
    });

    child.stderr?.on("data", (data: Buffer) => {
      this.io.emit("process:output" as any, {
        processId,
        stream: "stderr",
        data: data.toString(),
      });
    });

    child.on("exit", (code, signal) => {
      this.io.emit("process:exit" as any, {
        processId,
        code: code ?? -1,
        signal: signal || undefined,
      });
      this.runningProcess = null;
      this.runningProcessId = null;
    });

    child.on("error", (err) => {
      this.io.emit("process:output" as any, {
        processId,
        stream: "stderr",
        data: `Process error: ${err.message}\n`,
      });
      this.io.emit("process:exit" as any, {
        processId,
        code: -1,
        signal: undefined,
      });
      this.runningProcess = null;
      this.runningProcessId = null;
    });
  }

  /**
   * Kill the currently running process.
   */
  private killRunningProcess(): void {
    if (this.runningProcess) {
      try {
        this.runningProcess.kill("SIGTERM");
      } catch {}
      this.runningProcess = null;
      this.runningProcessId = null;
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────

  /**
   * Find bytecode for a contract name from the artifacts directory.
   */
  private findBytecodeInArtifacts(artifactsDir: string, contractName: string): string | undefined {
    try {
      const entries = fs.readdirSync(artifactsDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(artifactsDir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "build-info") continue;
          const found = this.findBytecodeInArtifacts(fullPath, contractName);
          if (found) return found;
        } else if (
          entry.isFile() &&
          entry.name === `${contractName}.json` &&
          !entry.name.endsWith(".dbg.json")
        ) {
          const raw = fs.readFileSync(fullPath, "utf-8");
          const artifact = JSON.parse(raw);
          if (artifact.bytecode && artifact.bytecode !== "0x") {
            return artifact.bytecode;
          }
        }
      }
    } catch {
      // ignore
    }
    return undefined;
  }

  private generateSessionId(): string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < 8; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Try to find the pre-built signing app in multiple locations.
   * Returns the path if found, null otherwise.
   */
  private resolveAppPath(userPath?: string): string | null {
    const candidates = [
      // 1. User-provided explicit path
      userPath,
      // 2. Monorepo sibling: packages/app/dist (when running from packages/plugin/dist)
      path.resolve(__dirname, "../../app/dist"),
      // 3. Same package: bundled app dist
      path.resolve(__dirname, "../app-dist"),
      // 4. From node_modules: look for the app package
      path.resolve(__dirname, "../../../hardhat-airsign-app/dist"),
    ].filter(Boolean) as string[];

    for (const candidate of candidates) {
      if (
        fs.existsSync(candidate) &&
        fs.existsSync(path.join(candidate, "index.html"))
      ) {
        return candidate;
      }
    }

    console.log(
      "  ⚠️  Signing app not found. Build it first:\n" +
      "     cd packages/app && npm run build"
    );
    return null;
  }
}

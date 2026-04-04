import { useState, useEffect, useCallback, useRef } from "react";
import { io, Socket } from "socket.io-client";

// ─── Types ──────────────────────────────────────────────────────
// Shared types — keep in sync with packages/plugin/src/types.ts
// These are the subset used by the signing UI.

export type {
  SignTransactionRequest,
  SignMessageRequest,
  SigningRequest,
  SigningResponse,
} from "../types";

import type { SigningRequest, SigningResponse } from "../types";

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

// ─── Hook ───────────────────────────────────────────────────────

/**
 * Accepts a callback that returns the current wallet state from wagmi.
 * This lets the hook re-announce wallet info to the server on reconnect
 * or when the server explicitly asks via `signing:requestWalletState`.
 */
export function useSigningSession(
  getWalletState?: () => {
    address: string | undefined;
    chainId: number;
    isConnected: boolean;
  }
) {
  const socketRef = useRef<Socket | null>(null);
  const getWalletStateRef = useRef(getWalletState);
  getWalletStateRef.current = getWalletState;

  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [pendingRequests, setPendingRequests] = useState<SigningRequest[]>([]);
  const [completedRequests, setCompletedRequests] = useState<
    (SigningRequest & { response: SigningResponse })[]
  >([]);

  // Helper: announce current wallet state to the server
  const announceWallet = useCallback((socket: Socket) => {
    const state = getWalletStateRef.current?.();
    if (state?.isConnected && state.address) {
      console.log("[AirSign] Re-announcing wallet to server:", state.address);
      socket.emit("signer:connected", {
        address: state.address,
        chainId: state.chainId,
      });
    }
  }, []);

  // Connect to the signing server via Socket.io
  useEffect(() => {
    setStatus("connecting");

    // Connect to the same origin (the Express server serving this app)
    const socket = io(window.location.origin, {
      transports: ["websocket", "polling"],
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("[AirSign] Connected to signing server");
      setStatus("connected");

      // KEY FIX: If wallet is already connected when socket connects
      // (e.g. server restarted, page was already open with wallet),
      // immediately announce the wallet so the server knows about it.
      announceWallet(socket);
    });

    socket.on("disconnect", () => {
      console.log("[AirSign] Disconnected from signing server");
      setStatus("disconnected");
    });

    socket.on("connect_error", (err) => {
      console.error("[AirSign] Connection error:", err.message);
      setStatus("disconnected");
    });

    // KEY FIX: Server asks us to re-announce wallet state.
    // This fires when server wants to confirm wallet status (e.g. deploy
    // script just connected and server needs to know if wallet is ready).
    socket.on("signing:requestWalletState", () => {
      console.log("[AirSign] Server requested wallet state");
      announceWallet(socket);
    });

    // Listen for signing requests from the Hardhat plugin
    socket.on("signing:request", (request: SigningRequest) => {
      console.log("[AirSign] Received signing request:", request.id);
      setPendingRequests((prev) => [...prev, request]);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [announceWallet]);

  // Notify the server when wallet is connected
  const notifyWalletConnected = useCallback(
    (address: string, chainId: number) => {
      if (socketRef.current?.connected) {
        socketRef.current.emit("signer:connected", { address, chainId });
      }
    },
    []
  );

  // Notify the server when wallet disconnects
  const notifyWalletDisconnected = useCallback(() => {
    if (socketRef.current?.connected) {
      socketRef.current.emit("signer:disconnected");
    }
  }, []);

  // Notify chain change
  const notifyChainChanged = useCallback((chainId: number) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit("signer:chainChanged", chainId);
    }
  }, []);

  // Notify account change
  const notifyAccountChanged = useCallback((address: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit("signer:accountChanged", address);
    }
  }, []);

  // Send signing response back to the Hardhat plugin
  const sendResponse = useCallback(
    (response: SigningResponse) => {
      if (socketRef.current?.connected) {
        socketRef.current.emit("signing:response", response);

        // Move from pending to completed
        setPendingRequests((prev) => {
          const request = prev.find((r) => r.id === response.id);
          if (request) {
            setCompletedRequests((completed) => [
              { ...request, response },
              ...completed,
            ]);
          }
          return prev.filter((r) => r.id !== response.id);
        });
      }
    },
    []
  );

  return {
    socket: socketRef.current,
    status,
    pendingRequests,
    completedRequests,
    notifyWalletConnected,
    notifyWalletDisconnected,
    notifyChainChanged,
    notifyAccountChanged,
    sendResponse,
  };
}

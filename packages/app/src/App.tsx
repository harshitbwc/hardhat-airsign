import React, { useEffect, useRef, useCallback } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId } from "wagmi";
import { useSigningSession } from "./hooks/useSigningSession";
import { SigningQueue } from "./components/SigningQueue";

export default function App() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();

  // Provide a callback so the hook can read current wallet state
  // on socket connect and when server requests it
  const getWalletState = useCallback(
    () => ({ address, chainId, isConnected }),
    [address, chainId, isConnected]
  );

  const {
    status,
    pendingRequests,
    completedRequests,
    notifyWalletConnected,
    notifyWalletDisconnected,
    notifyChainChanged,
    notifyAccountChanged,
    sendResponse,
  } = useSigningSession(getWalletState);

  // Track previous values to detect changes
  const prevConnected = useRef(false);
  const prevAddress = useRef<string | undefined>();
  const prevChainId = useRef<number | undefined>();

  // Notify server of wallet connection/disconnection
  useEffect(() => {
    if (isConnected && address && status === "connected") {
      if (!prevConnected.current) {
        // Wallet just connected
        notifyWalletConnected(address, chainId);
      } else if (prevAddress.current && prevAddress.current !== address) {
        // Account changed
        notifyAccountChanged(address);
      }
    } else if (!isConnected && prevConnected.current) {
      notifyWalletDisconnected();
    }

    prevConnected.current = isConnected;
    prevAddress.current = address;
  }, [
    isConnected,
    address,
    status,
    chainId,
    notifyWalletConnected,
    notifyWalletDisconnected,
    notifyAccountChanged,
  ]);

  // Notify server of chain changes
  useEffect(() => {
    if (isConnected && prevChainId.current && prevChainId.current !== chainId) {
      notifyChainChanged(chainId);
    }
    prevChainId.current = chainId;
  }, [chainId, isConnected, notifyChainChanged]);

  // ─── Render ───────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🔐</span>
            <div>
              <h1 className="text-white font-bold text-lg leading-tight">
                Hardhat AirSign
              </h1>
              <p className="text-gray-500 text-xs">
                Sign transactions from your wallet
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Connection Status Indicator */}
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  status === "connected"
                    ? "bg-green-400"
                    : status === "connecting"
                    ? "bg-yellow-400 animate-pulse"
                    : "bg-red-400"
                }`}
              />
              <span className="text-xs text-gray-500">
                {status === "connected"
                  ? "Server connected"
                  : status === "connecting"
                  ? "Connecting..."
                  : "Disconnected"}
              </span>
            </div>

            <ConnectButton
              showBalance={true}
              chainStatus="icon"
              accountStatus="avatar"
            />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 px-6 py-8">
        <div className="max-w-2xl mx-auto">
          {/* Step 1: Connect to server */}
          {status !== "connected" && (
            <div className="text-center py-16">
              <div className="text-5xl mb-4">🔌</div>
              <h2 className="text-xl text-white font-semibold mb-2">
                Connecting to signing server...
              </h2>
              <p className="text-gray-400">
                Make sure the Hardhat remote signer server is running.
              </p>
            </div>
          )}

          {/* Step 2: Connect wallet */}
          {status === "connected" && !isConnected && (
            <div className="text-center py-16">
              <div className="text-5xl mb-4">👛</div>
              <h2 className="text-xl text-white font-semibold mb-2">
                Connect your wallet
              </h2>
              <p className="text-gray-400 mb-6">
                Click the connect button above to link your wallet for signing.
              </p>
              <ConnectButton />
            </div>
          )}

          {/* Step 3: Ready — show signing queue */}
          {status === "connected" && isConnected && (
            <>
              <div className="bg-green-900/20 border border-green-800/50 rounded-lg p-4 mb-6 flex items-center gap-3">
                <span className="text-green-400 text-lg">✓</span>
                <div>
                  <p className="text-green-300 text-sm font-medium">
                    Ready to sign
                  </p>
                  <p className="text-green-600 text-xs">
                    Wallet connected. Waiting for transactions from Hardhat.
                  </p>
                </div>
              </div>

              <SigningQueue
                pendingRequests={pendingRequests}
                completedRequests={completedRequests}
                onResponse={sendResponse}
              />
            </>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 px-6 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between text-xs text-gray-600">
          <span>hardhat-airsign v0.1.0</span>
          <span>Your keys never leave your wallet</span>
        </div>
      </footer>
    </div>
  );
}

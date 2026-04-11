import React, { useState, useEffect, useRef, useCallback } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId } from "wagmi";
import { useSigningSession } from "./hooks/useSigningSession";
import { SigningQueue } from "./components/SigningQueue";
import { SigningModal } from "./components/SigningModal";
import { Runner } from "./components/Runner";
import { ContractsTab } from "./components/ContractsTab";

type AppTab = "signer" | "runner" | "contracts";

export default function App() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const [activeTab, setActiveTab] = useState<AppTab>("signer");

  const getWalletState = useCallback(
    () => ({ address, chainId, isConnected }),
    [address, chainId, isConnected]
  );

  const {
    socket,
    status,
    pendingRequests,
    completedRequests,
    notifyWalletConnected,
    notifyWalletDisconnected,
    notifyChainChanged,
    notifyAccountChanged,
    sendResponse,
  } = useSigningSession(getWalletState);

  const prevConnected = useRef(false);
  const prevAddress = useRef<string | undefined>();
  const prevChainId = useRef<number | undefined>();

  useEffect(() => {
    if (isConnected && address && status === "connected") {
      if (!prevConnected.current) {
        notifyWalletConnected(address, chainId);
      } else if (prevAddress.current && prevAddress.current !== address) {
        notifyAccountChanged(address);
      }
    } else if (!isConnected && prevConnected.current) {
      notifyWalletDisconnected();
    }
    prevConnected.current = isConnected;
    prevAddress.current = address;
  }, [isConnected, address, status, chainId, notifyWalletConnected, notifyWalletDisconnected, notifyAccountChanged]);

  useEffect(() => {
    if (isConnected && prevChainId.current && prevChainId.current !== chainId) {
      notifyChainChanged(chainId);
    }
    prevChainId.current = chainId;
  }, [chainId, isConnected, notifyChainChanged]);

  // Show signing modal overlay when on Runner tab and requests come in
  const showSigningModal = (activeTab === "runner" || activeTab === "contracts") && pendingRequests.length > 0;

  return (
    <div className="h-screen bg-[#0a0a0a] flex flex-col overflow-hidden">
      {/* ─── Header ─────────────────────────────────── */}
      <header className="flex-shrink-0 glass border-b border-white/[0.06] px-5 py-3 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Logo */}
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 2.18l7 3.12v5.7c0 4.83-3.4 9.36-7 10.55V3.18z" />
              </svg>
            </div>
            <div>
              <h1 className="text-white font-semibold text-[15px] leading-tight tracking-tight">
                AirSign
              </h1>
              <p className="text-gray-600 text-[10px] mt-0.5">
                Hardhat Remote Signer
              </p>
            </div>

            {/* Tab navigation */}
            {status === "connected" && isConnected && (
              <div className="ml-6 segment-control flex">
                <button
                  onClick={() => setActiveTab("signer")}
                  className={`relative text-[12px] font-medium py-1.5 px-4 rounded-lg transition-all ${
                    activeTab === "signer"
                      ? "segment-active text-white"
                      : "text-gray-500 hover:text-gray-400"
                  }`}
                >
                  Signer
                  {pendingRequests.length > 0 && activeTab !== "runner" && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-orange-500 rounded-full text-[9px] font-bold text-white flex items-center justify-center">
                      {pendingRequests.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setActiveTab("runner")}
                  className={`relative text-[12px] font-medium py-1.5 px-4 rounded-lg transition-all ${
                    activeTab === "runner"
                      ? "segment-active text-white"
                      : "text-gray-500 hover:text-gray-400"
                  }`}
                >
                  Runner
                </button>
                <button
                  onClick={() => setActiveTab("contracts")}
                  className={`relative text-[12px] font-medium py-1.5 px-4 rounded-lg transition-all ${
                    activeTab === "contracts"
                      ? "segment-active text-white"
                      : "text-gray-500 hover:text-gray-400"
                  }`}
                >
                  Contracts
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Status pill */}
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium ${
              status === "connected"
                ? "bg-green-500/10 text-green-400"
                : status === "connecting"
                ? "bg-yellow-500/10 text-yellow-400"
                : "bg-red-500/10 text-red-400"
            }`}>
              <div className={`w-1.5 h-1.5 rounded-full ${
                status === "connected"
                  ? "bg-green-400"
                  : status === "connecting"
                  ? "bg-yellow-400 animate-pulse"
                  : "bg-red-400"
              }`} />
              {status === "connected" ? "Connected" : status === "connecting" ? "Connecting" : "Offline"}
            </div>

            <ConnectButton
              showBalance={false}
              chainStatus="icon"
              accountStatus="avatar"
            />
          </div>
        </div>
      </header>

      {/* ─── Main Content ───────────────────────────── */}
      <main className="flex-1 flex flex-col min-h-0">
        {/* Not connected to server */}
        {status !== "connected" && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-white/[0.03] flex items-center justify-center mx-auto mb-5">
                <div className="w-6 h-6 border-2 border-gray-700 border-t-blue-400 rounded-full animate-spin" />
              </div>
              <h2 className="text-white text-lg font-semibold mb-2">
                Connecting to server
              </h2>
              <p className="text-gray-500 text-sm max-w-xs">
                Make sure the AirSign server is running with <code className="text-gray-400 bg-white/[0.04] px-1.5 py-0.5 rounded text-xs">npx hardhat airsign-start</code>
              </p>
            </div>
          </div>
        )}

        {/* Connected but no wallet */}
        {status === "connected" && !isConnected && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-white/[0.03] flex items-center justify-center mx-auto mb-5">
                <span className="text-3xl">{"\u{1F45B}"}</span>
              </div>
              <h2 className="text-white text-lg font-semibold mb-2">
                Connect your wallet
              </h2>
              <p className="text-gray-500 text-sm mb-6 max-w-xs">
                Link your browser wallet to start signing transactions
              </p>
              <div className="flex justify-center">
                <ConnectButton />
              </div>
            </div>
          </div>
        )}

        {/* ─── Signer Tab ──────────────────────────── */}
        {status === "connected" && isConnected && activeTab === "signer" && (
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-lg mx-auto px-6 py-8">
              {/* Status card */}
              <div className="glass rounded-2xl p-4 mb-6 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-green-500/10 flex items-center justify-center">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#30d158" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </div>
                <div>
                  <p className="text-white text-sm font-medium">Ready to sign</p>
                  <p className="text-gray-500 text-[11px]">
                    Listening for signing requests from Hardhat
                  </p>
                </div>
              </div>

              <SigningQueue
                pendingRequests={pendingRequests}
                completedRequests={completedRequests}
                onResponse={sendResponse}
              />
            </div>
          </div>
        )}

        {/* ─── Runner Tab (full width, 3-column) ────── */}
        {status === "connected" && isConnected && activeTab === "runner" && (
          <Runner socket={socket} />
        )}

        {/* ─── Contracts Tab (full width, 3-column) ──── */}
        {status === "connected" && isConnected && activeTab === "contracts" && (
          <ContractsTab socket={socket} />
        )}
      </main>

      {/* ─── Signing Modal (overlays Runner/Contracts) ── */}
      {showSigningModal && (
        <SigningModal
          requests={pendingRequests}
          onResponse={sendResponse}
        />
      )}
    </div>
  );
}

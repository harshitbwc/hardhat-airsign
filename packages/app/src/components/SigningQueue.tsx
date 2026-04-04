import React from "react";
import { useChainId } from "wagmi";
import { TransactionCard } from "./TransactionCard";
import {
  SigningRequest,
  SigningResponse,
} from "../hooks/useSigningSession";

const EXPLORERS: Record<number, string> = {
  1: "https://etherscan.io",
  5: "https://goerli.etherscan.io",
  11155111: "https://sepolia.etherscan.io",
  137: "https://polygonscan.com",
  80001: "https://mumbai.polygonscan.com",
  42161: "https://arbiscan.io",
  10: "https://optimistic.etherscan.io",
  8453: "https://basescan.org",
  56: "https://bscscan.com",
  43114: "https://snowtrace.io",
};

function getExplorerTxUrl(chainId: number, hash: string): string {
  const base = EXPLORERS[chainId] || EXPLORERS[1];
  return `${base}/tx/${hash}`;
}

function shortHash(h: string): string {
  return h ? `${h.slice(0, 10)}...${h.slice(-6)}` : "";
}

interface SigningQueueProps {
  pendingRequests: SigningRequest[];
  completedRequests: (SigningRequest & { response: SigningResponse })[];
  onResponse: (response: SigningResponse) => void;
}

export function SigningQueue({
  pendingRequests,
  completedRequests,
  onResponse,
}: SigningQueueProps) {
  const chainId = useChainId();

  return (
    <div className="w-full">
      {/* Pending Requests */}
      {pendingRequests.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1.5 h-1.5 bg-orange-400 rounded-full pulse-ring" />
            <h2 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
              Pending ({pendingRequests.length})
            </h2>
          </div>
          <div className="space-y-3">
            {pendingRequests.map((request) => (
              <TransactionCard
                key={request.id}
                request={request}
                onResponse={onResponse}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {pendingRequests.length === 0 && completedRequests.length === 0 && (
        <div className="text-center py-16">
          <div className="w-14 h-14 rounded-2xl bg-white/[0.03] flex items-center justify-center mx-auto mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-600">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12,6 12,12 16,14" />
            </svg>
          </div>
          <p className="text-gray-400 text-sm mb-1">
            Waiting for requests
          </p>
          <p className="text-gray-600 text-xs">
            Run a deploy script or use the Runner tab
          </p>
        </div>
      )}

      {/* History */}
      {completedRequests.length > 0 && (
        <div>
          <h2 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-3">
            History ({completedRequests.length})
          </h2>
          <div className="space-y-1.5">
            {completedRequests.map((item) => {
              const ok = item.response.success;
              const hash = item.response.result || "";
              const isTx = item.type === "sendTransaction";

              return (
                <div
                  key={item.id}
                  className="glass-subtle rounded-xl p-3.5 flex items-start gap-3"
                >
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    ok ? "bg-green-500/10" : "bg-red-500/10"
                  }`}>
                    {ok ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#30d158" strokeWidth="2.5" strokeLinecap="round">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ff453a" strokeWidth="2.5" strokeLinecap="round">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[13px] text-gray-300 font-medium">
                        {isTx ? "Transaction" : "Message"}
                      </span>
                      <span className={`text-[10px] font-medium ${
                        ok ? "text-green-400" : "text-red-400"
                      }`}>
                        {ok ? "Signed" : "Failed"}
                      </span>
                    </div>
                    {hash && (
                      <p className="text-[11px] text-gray-600 font-mono truncate">
                        {shortHash(hash)}
                      </p>
                    )}
                    {ok && hash && isTx && (
                      <a
                        href={getExplorerTxUrl(chainId, hash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-blue-400 hover:text-blue-300 transition-colors mt-1 inline-flex items-center gap-1"
                      >
                        View on Explorer
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <path d="M7 17L17 7M7 7h10v10" />
                        </svg>
                      </a>
                    )}
                    {!ok && item.response.error && (
                      <p className="text-[11px] text-red-400/60 mt-0.5 truncate">
                        {item.response.error}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

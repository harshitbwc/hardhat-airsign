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
  return h ? `${h.slice(0, 12)}...${h.slice(-6)}` : "";
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
    <div className="w-full max-w-lg mx-auto">
      {/* Pending Requests */}
      {pendingRequests.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
            <h2 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
              Pending ({pendingRequests.length})
            </h2>
          </div>
          {pendingRequests.map((request) => (
            <TransactionCard
              key={request.id}
              request={request}
              onResponse={onResponse}
            />
          ))}
        </div>
      )}

      {/* Empty State */}
      {pendingRequests.length === 0 && completedRequests.length === 0 && (
        <div className="text-center py-16">
          <div className="text-4xl mb-4">{"\u23F3"}</div>
          <p className="text-gray-400 text-base">
            Waiting for signing requests...
          </p>
          <p className="text-gray-600 text-sm mt-2">
            Run a Hardhat deploy script in another terminal.
          </p>
        </div>
      )}

      {/* History */}
      {completedRequests.length > 0 && (
        <div>
          <h2 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-3">
            History ({completedRequests.length})
          </h2>
          {completedRequests.map((item) => {
            const ok = item.response.success;
            const hash = item.response.result || "";
            const isTx = item.type === "sendTransaction";

            return (
              <div
                key={item.id}
                className="bg-gray-800/40 border border-gray-800/60 rounded-lg p-3.5 mb-2 flex items-start gap-3"
              >
                <span className="mt-0.5 text-base">
                  {ok ? "\u2705" : "\u274C"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-gray-300 font-medium">
                      {isTx ? "Transaction" : "Message Signed"}
                    </span>
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                        ok
                          ? "bg-green-900/20 text-green-400"
                          : "bg-red-900/20 text-red-400"
                      }`}
                    >
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
                      className="text-[11px] text-blue-400 hover:text-blue-300 transition-colors mt-1 inline-block"
                    >
                      View on Explorer {"\u2197"}
                    </a>
                  )}
                  {!ok && item.response.error && (
                    <p className="text-[11px] text-red-400/70 mt-0.5">
                      {item.response.error}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

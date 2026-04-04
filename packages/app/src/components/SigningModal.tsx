import React, { useState } from "react";
import { useWalletClient } from "wagmi";
import type {
  SigningRequest,
  SignTransactionRequest,
  SignMessageRequest,
  SigningResponse,
} from "../types";

interface SigningModalProps {
  requests: SigningRequest[];
  onResponse: (response: SigningResponse) => void;
}

export function SigningModal({ requests, onResponse }: SigningModalProps) {
  if (requests.length === 0) return null;

  return (
    <div className="fixed inset-0 z-50 modal-overlay">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <div className="absolute inset-0 flex items-center justify-center p-6">
        <div className="modal-content w-full max-w-md">
          {/* Badge */}
          <div className="flex justify-center mb-4">
            <div className="glass px-4 py-1.5 rounded-full flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-orange-400 pulse-ring" />
              <span className="text-xs font-medium text-orange-300">
                {requests.length} signing {requests.length === 1 ? "request" : "requests"}
              </span>
            </div>
          </div>

          {/* Cards */}
          <div className="space-y-3 max-h-[70vh] overflow-y-auto">
            {requests.map((request) => (
              <ModalTransactionCard
                key={request.id}
                request={request}
                onResponse={onResponse}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ModalTransactionCard({
  request,
  onResponse,
}: {
  request: SigningRequest;
  onResponse: (response: SigningResponse) => void;
}) {
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showData, setShowData] = useState(false);
  const { data: walletClient } = useWalletClient();

  const isTx = request.type === "sendTransaction";
  const txData = isTx ? (request as SignTransactionRequest).transaction : null;
  const metadata = isTx ? (request as SignTransactionRequest).metadata : null;

  const handleConfirm = async () => {
    if (!walletClient) {
      setError("Wallet not connected");
      return;
    }

    setSigning(true);
    setError(null);

    try {
      if (request.type === "sendTransaction") {
        const tx = (request as SignTransactionRequest).transaction;
        const txParams: Record<string, any> = {
          to: tx.to as `0x${string}` | undefined,
          data: tx.data as `0x${string}` | undefined,
          value: tx.value ? BigInt(tx.value) : undefined,
          gas: tx.gasLimit ? BigInt(tx.gasLimit) : undefined,
          nonce: tx.nonce,
        };
        if (tx.maxFeePerGas) {
          txParams.maxFeePerGas = BigInt(tx.maxFeePerGas);
          if (tx.maxPriorityFeePerGas) {
            txParams.maxPriorityFeePerGas = BigInt(tx.maxPriorityFeePerGas);
          }
        } else if (tx.gasPrice) {
          txParams.gasPrice = BigInt(tx.gasPrice);
        }
        const hash = await walletClient.sendTransaction(txParams as any);
        onResponse({ id: request.id, success: true, result: hash });
      } else if (request.type === "signMessage") {
        const msg = (request as SignMessageRequest).message;
        const signature = await walletClient.signMessage({ message: msg });
        onResponse({ id: request.id, success: true, result: signature });
      }
    } catch (err: any) {
      const errorMsg = err?.shortMessage || err?.message || "Transaction rejected";
      setError(errorMsg);
      onResponse({ id: request.id, success: false, error: errorMsg });
    } finally {
      setSigning(false);
    }
  };

  const handleReject = () => {
    onResponse({
      id: request.id,
      success: false,
      error: "Transaction rejected by signer",
    });
  };

  const formatValue = (hex: string | undefined) => {
    if (!hex || hex === "0x0" || hex === "0x00") return "0 ETH";
    try {
      const wei = BigInt(hex);
      const eth = Number(wei) / 1e18;
      if (eth < 0.0001) return `${Number(wei)} wei`;
      return `${eth.toFixed(6)} ETH`;
    } catch {
      return hex;
    }
  };

  const shortAddr = (addr: string) =>
    addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "";

  const hasData = !!(txData?.data && txData.data !== "0x" && txData.data.length > 2);
  const dataBytes = hasData ? (txData!.data!.length - 2) / 2 : 0;

  return (
    <div className="glass rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-5 pb-3">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2.5">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg ${
              isTx ? "bg-blue-500/15" : "bg-purple-500/15"
            }`}>
              {isTx ? (txData?.to ? "\u2197\uFE0F" : "\u{1F4E6}") : "\u270D\uFE0F"}
            </div>
            <div>
              <h3 className="text-white text-sm font-semibold">
                {isTx
                  ? txData?.to
                    ? metadata?.functionName || "Contract Call"
                    : metadata?.contractName
                    ? `Deploy ${metadata.contractName}`
                    : "Deploy Contract"
                  : "Sign Message"}
              </h3>
              {metadata?.contractName && txData?.to && (
                <p className="text-gray-500 text-[11px]">{metadata.contractName}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Details */}
      {isTx && txData && (
        <div className="mx-5 mb-3 rounded-xl bg-black/20 p-3.5 space-y-2">
          {txData.to && (
            <div className="flex justify-between items-center">
              <span className="text-gray-500 text-[11px]">To</span>
              <span className="text-blue-400 text-[11px] font-mono">
                {shortAddr(txData.to)}
              </span>
            </div>
          )}
          <div className="flex justify-between items-center">
            <span className="text-gray-500 text-[11px]">Value</span>
            <span className="text-white text-[11px] font-mono">
              {formatValue(txData.value)}
            </span>
          </div>
          {hasData && (
            <div className="flex justify-between items-center">
              <span className="text-gray-500 text-[11px]">Data</span>
              <button
                onClick={() => setShowData(!showData)}
                className="text-gray-400 hover:text-gray-300 text-[11px] font-mono transition-colors"
              >
                {txData.data!.slice(0, 10)} ({dataBytes}B) {showData ? "\u25B4" : "\u25BE"}
              </button>
            </div>
          )}
          {showData && hasData && (
            <div className="mt-1 p-2 rounded-lg bg-black/30 font-mono text-[10px] text-gray-500 break-all max-h-24 overflow-y-auto leading-relaxed">
              {txData.data}
            </div>
          )}
        </div>
      )}

      {!isTx && (
        <div className="mx-5 mb-3 rounded-xl bg-black/20 p-3.5">
          <p className="text-gray-300 text-xs break-all leading-relaxed">
            {(request as SignMessageRequest).message}
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mx-5 mb-3 rounded-xl bg-red-500/10 border border-red-500/20 p-3">
          <p className="text-red-400 text-xs">{error}</p>
        </div>
      )}

      {/* Actions */}
      <div className="px-5 pb-5 flex gap-2.5">
        <button
          onClick={handleReject}
          disabled={signing}
          className="flex-1 py-3 rounded-xl text-sm font-semibold transition-all
            bg-white/5 hover:bg-white/8 text-gray-300 hover:text-white
            disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Reject
        </button>
        <button
          onClick={handleConfirm}
          disabled={signing}
          className="flex-[2] py-3 rounded-xl text-sm font-semibold transition-all
            bg-blue-500 hover:bg-blue-400 text-white
            disabled:opacity-70 disabled:cursor-not-allowed"
        >
          {signing ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Confirming...
            </span>
          ) : (
            isTx ? "Confirm" : "Sign"
          )}
        </button>
      </div>
    </div>
  );
}

import React, { useState } from "react";
import { useWalletClient } from "wagmi";
import {
  SigningRequest,
  SignTransactionRequest,
  SignMessageRequest,
  SigningResponse,
} from "../hooks/useSigningSession";

interface TransactionCardProps {
  request: SigningRequest;
  onResponse: (response: SigningResponse) => void;
}

export function TransactionCard({ request, onResponse }: TransactionCardProps) {
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFullData, setShowFullData] = useState(false);
  const { data: walletClient } = useWalletClient();

  const handleConfirm = async () => {
    if (!walletClient) {
      setError("Wallet not connected");
      return;
    }

    setSigning(true);
    setError(null);

    try {
      if (request.type === "sendTransaction") {
        const txRequest = request as SignTransactionRequest;
        const tx = txRequest.transaction;

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

        onResponse({
          id: request.id,
          success: true,
          result: hash,
        });
      } else if (request.type === "signMessage") {
        const msgRequest = request as SignMessageRequest;

        const signature = await walletClient.signMessage({
          message: msgRequest.message,
        });

        onResponse({
          id: request.id,
          success: true,
          result: signature,
        });
      }
    } catch (err: any) {
      const errorMsg = err?.shortMessage || err?.message || "Transaction rejected";
      setError(errorMsg);
      onResponse({
        id: request.id,
        success: false,
        error: errorMsg,
      });
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

  // ─── Render helpers ──────────────────────────────────────────

  const isTx = request.type === "sendTransaction";
  const txData = isTx ? (request as SignTransactionRequest).transaction : null;

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
    <div className="bg-gray-800/80 border border-gray-700/60 rounded-xl p-5 mb-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-lg">{isTx ? "\u{1F4E4}" : "\u270D\uFE0F"}</span>
          <h3 className="text-white font-semibold">
            {isTx ? "Send Transaction" : "Sign Message"}
          </h3>
        </div>
        <span className="text-[11px] text-gray-500 bg-gray-800 px-2 py-0.5 rounded font-mono">
          {isTx ? (txData?.to ? "Contract Call" : "Deploy") : "Personal Sign"}
        </span>
      </div>

      {/* Transaction Details */}
      {isTx && txData && (
        <div className="bg-gray-900/80 rounded-lg p-4 mb-3 space-y-2 font-mono text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500 text-xs">To</span>
            {txData.to ? (
              <span className="text-blue-400 text-xs">{shortAddr(txData.to)}</span>
            ) : (
              <span className="text-purple-400 text-xs">New Contract</span>
            )}
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500 text-xs">Value</span>
            <span className="text-green-400 text-xs">{formatValue(txData.value)}</span>
          </div>
          {hasData && (
            <div className="flex justify-between">
              <span className="text-gray-500 text-xs">Data</span>
              <span className="text-amber-400 text-xs">
                {txData.data!.slice(0, 10)} ({dataBytes} bytes)
              </span>
            </div>
          )}
        </div>
      )}

      {/* Expandable full transaction data */}
      {isTx && hasData && (
        <div className="mb-3">
          <button
            onClick={() => setShowFullData(!showFullData)}
            className="text-blue-400 hover:text-blue-300 text-xs transition-colors"
          >
            {showFullData ? "\u25BC Hide transaction data" : "\u25B6 View full transaction data"}
          </button>
          {showFullData && (
            <div className="mt-2 bg-gray-900 border border-gray-800 rounded-lg p-3 font-mono text-[11px] text-gray-400 break-all max-h-48 overflow-y-auto leading-relaxed">
              {txData!.data}
            </div>
          )}
        </div>
      )}

      {/* Message Details */}
      {!isTx && (
        <div className="bg-gray-900/80 rounded-lg p-4 mb-3">
          <p className="text-gray-300 text-sm break-all">
            {(request as SignMessageRequest).message}
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-900/20 border border-red-800/40 rounded-lg p-3 mb-3">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3">
        <button
          onClick={handleConfirm}
          disabled={signing}
          className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800/60 disabled:cursor-not-allowed text-white font-semibold py-2.5 px-6 rounded-lg transition-colors text-sm"
        >
          {signing ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Signing...
            </span>
          ) : isTx ? (
            "Sign & Send"
          ) : (
            "Sign"
          )}
        </button>
        <button
          onClick={handleReject}
          disabled={signing}
          className="bg-transparent border border-gray-700 hover:border-gray-600 hover:bg-gray-800 disabled:cursor-not-allowed text-gray-400 font-medium py-2.5 px-5 rounded-lg transition-colors text-sm"
        >
          Reject
        </button>
      </div>
    </div>
  );
}

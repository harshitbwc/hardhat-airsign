/**
 * ContractAddressModal — batch address editor for ALL contracts.
 *
 * Opens from a single "Set Addresses" button. Shows every contract in a list,
 * each with an address input for the selected network. User can set/edit
 * addresses for all contracts in one place, then save all at once.
 */

import React, { useState, useEffect, useCallback } from "react";
import type { ContractInfo, NetworkInfo } from "../types";

interface ContractAddressModalProps {
  contracts: ContractInfo[];
  networks: NetworkInfo[];
  selectedNetwork: string;
  onSave: (contractName: string, networkName: string, address: string) => void;
  onClose: () => void;
  onCheckProxy?: (address: string, network: string) => Promise<{
    isProxy: boolean;
    implementationAddress?: string;
    adminAddress?: string;
    matchedContract?: string;
  }>;
}

const isValidAddr = (addr: string) => !addr || /^0x[a-fA-F0-9]{40}$/.test(addr);

export function ContractAddressModal({
  contracts,
  networks,
  selectedNetwork,
  onSave,
  onClose,
  onCheckProxy,
}: ContractAddressModalProps) {
  const [network, setNetwork] = useState(selectedNetwork);

  // Local editable map: contractName → address (for the selected network)
  const [editAddresses, setEditAddresses] = useState<Record<string, string>>({});

  // Track which addresses were changed so we only save diffs
  const [dirty, setDirty] = useState<Set<string>>(new Set());

  // Proxy check results
  const [proxyResults, setProxyResults] = useState<Record<string, {
    isProxy: boolean;
    implementationAddress?: string;
    matchedContract?: string;
  }>>({});
  const [checkingProxy, setCheckingProxy] = useState<string | null>(null);

  // Sync addresses from contracts when network changes
  useEffect(() => {
    const addrs: Record<string, string> = {};
    for (const c of contracts) {
      addrs[c.contractName] = c.deployedAddresses[network] || "";
    }
    setEditAddresses(addrs);
    setDirty(new Set());
    setProxyResults({});
  }, [network, contracts]);

  const handleAddrChange = (contractName: string, value: string) => {
    setEditAddresses((prev) => ({ ...prev, [contractName]: value }));
    setDirty((prev) => new Set(prev).add(contractName));
    // Clear proxy result when address changes
    setProxyResults((prev) => {
      const next = { ...prev };
      delete next[contractName];
      return next;
    });
  };

  const handleCheckProxy = async (contractName: string) => {
    if (!onCheckProxy) return;
    const addr = editAddresses[contractName];
    if (!addr || !isValidAddr(addr)) return;

    setCheckingProxy(contractName);
    try {
      const result = await onCheckProxy(addr, network);
      setProxyResults((prev) => ({ ...prev, [contractName]: result }));
    } finally {
      setCheckingProxy(null);
    }
  };

  const handleSaveAll = () => {
    for (const contractName of dirty) {
      const addr = editAddresses[contractName];
      if (addr && isValidAddr(addr)) {
        onSave(contractName, network, addr);
      }
    }
    onClose();
  };

  const changedCount = dirty.size;
  const allValid = [...dirty].every((name) => isValidAddr(editAddresses[name] || ""));

  // Count addresses set for current network
  const setCount = Object.values(editAddresses).filter((a) => !!a && isValidAddr(a)).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass rounded-2xl w-[560px] max-h-[85vh] flex flex-col border border-white/[0.08] shadow-2xl">
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div>
            <h2 className="text-white text-sm font-semibold">Contract Addresses</h2>
            <p className="text-gray-500 text-[11px] mt-0.5">
              {setCount} of {contracts.length} configured for {network}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg bg-white/[0.04] flex items-center justify-center hover:bg-white/[0.08] transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-500">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Network tabs */}
        <div className="flex-shrink-0 px-5 py-3 border-b border-white/[0.06]">
          <div className="flex flex-wrap gap-1.5">
            {networks.map((net) => {
              const countForNet = contracts.filter((c) => !!c.deployedAddresses[net.name]).length;
              return (
                <button
                  key={net.name}
                  onClick={() => setNetwork(net.name)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors flex items-center gap-1.5 ${
                    network === net.name
                      ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                      : "bg-white/[0.04] text-gray-500 border border-white/[0.08] hover:border-white/[0.12]"
                  }`}
                >
                  {net.name}
                  {countForNet > 0 && (
                    <span className={`text-[9px] px-1 py-0.5 rounded-full ${
                      network === net.name ? "bg-blue-500/30 text-blue-300" : "bg-white/[0.06] text-gray-600"
                    }`}>
                      {countForNet}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Contract list with address inputs */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          {contracts.map((contract) => {
            const addr = editAddresses[contract.contractName] || "";
            const valid = isValidAddr(addr);
            const isDirty = dirty.has(contract.contractName);
            const proxy = proxyResults[contract.contractName];
            const isChecking = checkingProxy === contract.contractName;

            return (
              <div
                key={contract.contractName}
                className={`rounded-xl border p-3 transition-colors ${
                  isDirty
                    ? "bg-blue-500/[0.03] border-blue-500/20"
                    : "bg-white/[0.02] border-white/[0.06]"
                }`}
              >
                {/* Contract name + stats */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${
                      addr && valid ? "bg-green-400" : "bg-gray-700"
                    }`} />
                    <span className="text-white text-[12px] font-medium">
                      {contract.contractName}
                    </span>
                    <span className="text-gray-700 text-[10px]">
                      {contract.functions.read.length}R / {contract.functions.write.length}W
                    </span>
                  </div>

                  {/* Proxy check button */}
                  {onCheckProxy && addr && valid && (
                    <button
                      onClick={() => handleCheckProxy(contract.contractName)}
                      disabled={isChecking}
                      className="text-[10px] text-gray-600 hover:text-blue-400 transition-colors flex items-center gap-1"
                    >
                      {isChecking ? (
                        <div className="w-2.5 h-2.5 border border-blue-400 border-t-transparent rounded-full animate-spin" />
                      ) : proxy ? (
                        proxy.isProxy ? (
                          <span className="text-purple-400">Proxy</span>
                        ) : (
                          <span className="text-gray-600">Not proxy</span>
                        )
                      ) : (
                        "Check proxy"
                      )}
                    </button>
                  )}
                </div>

                {/* Address input */}
                <input
                  className={`w-full bg-white/[0.04] border rounded-lg px-3 py-2 text-[12px] text-white font-mono placeholder-gray-600 focus:outline-none focus:ring-1 transition-colors ${
                    addr && !valid
                      ? "border-red-500/50 focus:border-red-500/50 focus:ring-red-500/20"
                      : "border-white/[0.08] focus:border-blue-500/50 focus:ring-blue-500/20"
                  }`}
                  placeholder="0x..."
                  value={addr}
                  onChange={(e) => handleAddrChange(contract.contractName, e.target.value)}
                  spellCheck={false}
                />

                {/* Validation error */}
                {addr && !valid && (
                  <p className="text-[10px] text-red-400 mt-1">Invalid address</p>
                )}

                {/* Proxy result */}
                {proxy?.isProxy && (
                  <div className="mt-2 bg-purple-500/10 border border-purple-500/20 rounded-lg px-2.5 py-1.5">
                    <p className="text-[10px] text-purple-400">
                      ERC-1967 Proxy → <span className="font-mono text-gray-400">{proxy.implementationAddress?.slice(0, 10)}...</span>
                      {proxy.matchedContract && (
                        <span className="text-purple-300 ml-1">({proxy.matchedContract})</span>
                      )}
                    </p>
                  </div>
                )}

                {/* Source hint */}
                {contract.sourceName && (
                  <p className="text-[9px] text-gray-700 mt-1 truncate">{contract.sourceName}</p>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 flex items-center justify-between px-5 py-4 border-t border-white/[0.06]">
          <span className="text-gray-600 text-[11px]">
            {changedCount > 0 ? `${changedCount} changed` : "No changes"}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveAll}
              disabled={changedCount === 0 || !allValid}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Save All
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

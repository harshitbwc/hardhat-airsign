/**
 * ContractsTab — 3-column layout for interacting with smart contracts.
 *
 * Left panel (w-64):   Contract list + network selector + Set Addresses / Deploy buttons
 * Middle panel (flex-1): Function explorer (read/write) with inputs & results
 * Right panel (w-80):  Activity log + event viewer
 *
 * Follows the same layout pattern as Runner.tsx.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import type { Socket } from "socket.io-client";
import { useChainId } from "wagmi";
import { useContracts } from "../hooks/useContracts";
import { SolidityInput, parseInputValue } from "./SolidityInputs";
import { ContractAddressModal } from "./ContractAddressModal";
import { EventViewer } from "./EventViewer";
import { getExplorerTxUrl, getExplorerAddressUrl, shortHash } from "../utils/explorers";
import type {
  ContractInfo,
  ABIFunction,
  ABIParam,
  NetworkInfo,
  DecodedEvent,
  ActivityLogEntry,
} from "../types";

interface ContractsTabProps {
  socket: Socket | null;
}

// ─── Main Component ─────────────────────────────────────────────

export function ContractsTab({ socket }: ContractsTabProps) {
  const chainId = useChainId();
  const {
    contracts,
    networks,
    loading,
    activityLog,
    executeRead,
    executeWrite,
    fetchEvents,
    saveAddress,
    checkProxy,
    rescan,
    clearLog,
  } = useContracts();

  const [selectedContract, setSelectedContract] = useState<ContractInfo | null>(null);
  const [selectedNetwork, setSelectedNetwork] = useState<string>("");
  const [selectedFunction, setSelectedFunction] = useState<ABIFunction | null>(null);
  const [funcFilter, setFuncFilter] = useState<"all" | "read" | "write">("all");
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [payableValue, setPayableValue] = useState<string>("0");

  // Per-function state: keyed by function signature
  const [callResults, setCallResults] = useState<Record<string, { success: boolean; result?: any; error?: string; txHash?: string; events?: DecodedEvent[] }>>({});
  const [callingFns, setCallingFns] = useState<Set<string>>(new Set());

  const [showAddressModal, setShowAddressModal] = useState(false);
  const [showDeployModal, setShowDeployModal] = useState<ContractInfo | null>(null);
  const [txHashInput, setTxHashInput] = useState("");
  const [txEvents, setTxEvents] = useState<DecodedEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  // Auto-select first remoteSigner network
  useEffect(() => {
    if (!selectedNetwork && networks.length > 0) {
      const remote = networks.find((n) => n.remoteSigner);
      setSelectedNetwork(remote?.name || networks[0].name);
    }
  }, [networks, selectedNetwork]);

  // Auto-select first contract
  useEffect(() => {
    if (!selectedContract && contracts.length > 0) {
      setSelectedContract(contracts[0]);
    }
  }, [contracts, selectedContract]);

  // Reset function selection when contract changes
  useEffect(() => {
    setSelectedFunction(null);
    setInputValues({});
    setCallResults({});
    setCallingFns(new Set());
  }, [selectedContract]);

  // Get the current contract address for the selected network
  const currentAddress = selectedContract?.deployedAddresses[selectedNetwork] || "";

  // Get filtered functions
  const filteredFunctions = selectedContract
    ? funcFilter === "read"
      ? selectedContract.functions.read
      : funcFilter === "write"
        ? selectedContract.functions.write
        : [...selectedContract.functions.read, ...selectedContract.functions.write]
    : [];

  // ─── Handlers ───────────────────────────────────────────────────

  const handleSelectFunction = (fn: ABIFunction) => {
    setSelectedFunction(fn);
    setInputValues({});
    setPayableValue("0");
    // Don't clear results/loading — let them persist per-function
  };

  const handleInputChange = (paramName: string, value: string) => {
    setInputValues((prev) => ({ ...prev, [paramName]: value }));
  };

  const handleCall = async () => {
    if (!selectedContract || !selectedFunction || !currentAddress) return;

    const fnSig = selectedFunction.signature;

    // Mark this specific function as calling
    setCallingFns((prev) => new Set(prev).add(fnSig));
    setCallResults((prev) => {
      const next = { ...prev };
      delete next[fnSig]; // clear old result for this function
      return next;
    });

    try {
      // Parse input values
      const args = selectedFunction.inputs.map((param, i) => {
        const key = param.name || `arg${i}`;
        const raw = inputValues[key] || "";
        return parseInputValue(param.type, raw);
      });

      const isRead =
        selectedFunction.stateMutability === "view" ||
        selectedFunction.stateMutability === "pure";

      if (isRead) {
        const result = await executeRead(
          currentAddress,
          selectedContract.abi,
          selectedFunction.name,
          args,
          selectedNetwork,
          selectedContract.contractName
        );
        setCallResults((prev) => ({ ...prev, [fnSig]: result }));
      } else {
        if (!socket) {
          setCallResults((prev) => ({ ...prev, [fnSig]: { success: false, error: "Not connected to server" } }));
          return;
        }

        const data = await executeWrite(
          currentAddress,
          selectedContract.abi,
          selectedFunction.name,
          args,
          selectedNetwork,
          selectedContract.contractName,
          selectedFunction.payable ? payableValue : "0"
        );
        setCallResults((prev) => ({ ...prev, [fnSig]: data }));

        // Auto-fetch events inline for the result display
        if (data.success && data.txHash) {
          setTxHashInput(data.txHash);
          // Fetch events after a short delay (tx needs to confirm)
          setTimeout(async () => {
            try {
              const evtResult = await fetchEvents(
                currentAddress,
                selectedContract!.abi,
                data.txHash!,
                selectedNetwork,
                selectedContract!.contractName
              );
              if (evtResult.success && evtResult.events && evtResult.events.length > 0) {
                setCallResults((prev) => ({
                  ...prev,
                  [fnSig]: { ...prev[fnSig], events: evtResult.events },
                }));
                setTxEvents(evtResult.events);
              }
            } catch {
              // silently ignore
            }
          }, 4000);
        }
      }
    } catch (err: any) {
      setCallResults((prev) => ({ ...prev, [fnSig]: { success: false, error: err.message } }));
    } finally {
      setCallingFns((prev) => {
        const next = new Set(prev);
        next.delete(fnSig);
        return next;
      });
    }
  };

  const handleFetchEvents = async (hash?: string) => {
    const txHash = hash || txHashInput;
    if (!selectedContract || !txHash || !currentAddress) return;

    setLoadingEvents(true);
    try {
      const result = await fetchEvents(
        currentAddress,
        selectedContract.abi,
        txHash,
        selectedNetwork,
        selectedContract.contractName
      );
      if (result.success && result.events) {
        setTxEvents(result.events);
      }
    } finally {
      setLoadingEvents(false);
    }
  };

  // Is the CURRENTLY SELECTED function loading?
  const isCurrentFnCalling = selectedFunction ? callingFns.has(selectedFunction.signature) : false;
  const currentFnResult = selectedFunction ? callResults[selectedFunction.signature] || null : null;

  // ─── Loading State ──────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="w-5 h-5 border-2 border-gray-700 border-t-blue-400 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Loading contracts...</p>
        </div>
      </div>
    );
  }

  if (contracts.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-sm">
          <div className="w-14 h-14 rounded-2xl bg-white/[0.03] flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">📜</span>
          </div>
          <h3 className="text-white text-sm font-medium mb-2">No contracts found</h3>
          <p className="text-gray-500 text-[12px] mb-4">
            Compile your contracts first with <code className="text-gray-400 bg-white/[0.04] px-1.5 py-0.5 rounded text-[11px]">npx hardhat compile</code> then click rescan.
          </p>
          <button
            onClick={rescan}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors"
          >
            Rescan Artifacts
          </button>
        </div>
      </div>
    );
  }

  // ─── 3-Column Layout ────────────────────────────────────────────

  return (
    <>
      <div className="flex-1 flex min-h-0">
        {/* ─── Left Panel: Contract List ──────────────── */}
        <div className="w-64 flex-shrink-0 border-r border-white/[0.06] flex flex-col">
          {/* Network selector */}
          <div className="px-3 py-3 border-b border-white/[0.06]">
            <label className="text-[10px] text-gray-600 uppercase tracking-wider mb-1.5 block">
              Network
            </label>
            <select
              value={selectedNetwork}
              onChange={(e) => setSelectedNetwork(e.target.value)}
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-[12px] text-white focus:outline-none focus:border-blue-500/50 appearance-none cursor-pointer"
            >
              {networks.map((net) => (
                <option key={net.name} value={net.name}>
                  {net.name}{net.chainId ? ` (${net.chainId})` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Contract list header + Set Addresses button */}
          <div className="px-3 py-2 flex items-center justify-between border-b border-white/[0.06]">
            <span className="text-[10px] text-gray-600 uppercase tracking-wider">
              Contracts ({contracts.length})
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowAddressModal(true)}
                className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
                title="Set addresses for all contracts"
              >
                Set Addresses
              </button>
              <button
                onClick={rescan}
                className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
                title="Rescan artifacts"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M23 4v6h-6M1 20v-6h6" />
                  <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                </svg>
              </button>
            </div>
          </div>

          {/* Contract list */}
          <div className="flex-1 overflow-y-auto px-2 pb-2">
            {contracts.map((contract) => {
              const hasAddr = !!contract.deployedAddresses[selectedNetwork];
              const isSelected = selectedContract?.contractName === contract.contractName;
              const hasBytecode = true; // all scanned contracts have bytecode

              return (
                <div
                  key={contract.contractName}
                  className={`rounded-xl mb-1 transition-colors ${
                    isSelected
                      ? "bg-white/[0.06] border border-white/[0.08]"
                      : "hover:bg-white/[0.03] border border-transparent"
                  }`}
                >
                  <button
                    onClick={() => setSelectedContract(contract)}
                    className="w-full text-left px-3 py-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        hasAddr ? "bg-green-400" : "bg-gray-700"
                      }`} />
                      <span className="text-[12px] text-white font-medium truncate flex-1">
                        {contract.contractName}
                      </span>
                      {/* Deploy button */}
                      <span
                        onClick={(e) => { e.stopPropagation(); setShowDeployModal(contract); }}
                        className="text-[10px] text-gray-600 hover:text-orange-400 transition-colors px-1.5 py-0.5 rounded hover:bg-white/[0.04] flex-shrink-0"
                        title="Deploy contract"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 ml-4">
                      <span className="text-[10px] text-gray-600">
                        {contract.functions.read.length}R / {contract.functions.write.length}W
                      </span>
                      {contract.events.length > 0 && (
                        <span className="text-[10px] text-gray-700">
                          {contract.events.length}E
                        </span>
                      )}
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* ─── Middle Panel: Function Explorer ─────────── */}
        <div className="flex-1 flex flex-col min-w-0">
          {selectedContract ? (
            <>
              {/* Contract header with address */}
              <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
                <div className="min-w-0">
                  <h3 className="text-white text-[14px] font-semibold">{selectedContract.contractName}</h3>
                  {currentAddress ? (
                    <p className="text-gray-500 text-[11px] font-mono truncate">{currentAddress}</p>
                  ) : (
                    <p className="text-yellow-500/70 text-[11px]">No address set for {selectedNetwork}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => setShowDeployModal(selectedContract)}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-orange-500/15 border border-orange-500/20 text-orange-400 hover:bg-orange-500/25 transition-colors"
                  >
                    Deploy
                  </button>
                  <button
                    onClick={() => setShowAddressModal(true)}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-white/[0.04] border border-white/[0.08] text-gray-400 hover:text-white hover:border-white/[0.12] transition-colors"
                  >
                    {currentAddress ? "Change" : "Set Address"}
                  </button>
                </div>
              </div>

              {/* Function filter tabs */}
              <div className="px-4 py-2 border-b border-white/[0.06] flex items-center gap-1">
                {(["all", "read", "write"] as const).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setFuncFilter(filter)}
                    className={`px-3 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                      funcFilter === filter
                        ? "bg-white/[0.08] text-white"
                        : "text-gray-600 hover:text-gray-400"
                    }`}
                  >
                    {filter === "all"
                      ? `All (${(selectedContract.functions.read.length + selectedContract.functions.write.length)})`
                      : filter === "read"
                        ? `Read (${selectedContract.functions.read.length})`
                        : `Write (${selectedContract.functions.write.length})`}
                  </button>
                ))}
              </div>

              {/* Function list + detail */}
              <div className="flex-1 flex min-h-0">
                {/* Function list */}
                <div className="w-48 flex-shrink-0 border-r border-white/[0.06] overflow-y-auto py-1">
                  {filteredFunctions.map((fn) => {
                    const isRead = fn.stateMutability === "view" || fn.stateMutability === "pure";
                    const isSelected = selectedFunction?.signature === fn.signature;
                    const isBusy = callingFns.has(fn.signature);
                    const hasResult = !!callResults[fn.signature];

                    return (
                      <button
                        key={fn.signature}
                        onClick={() => handleSelectFunction(fn)}
                        className={`w-full text-left px-3 py-2 transition-colors flex items-center gap-2 ${
                          isSelected ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                          isBusy
                            ? "bg-yellow-400 animate-pulse"
                            : isRead ? "bg-green-400" : fn.payable ? "bg-orange-400" : "bg-blue-400"
                        }`} />
                        <span className="text-[12px] text-gray-300 truncate">{fn.name}</span>
                        {fn.inputs.length > 0 && (
                          <span className="text-[10px] text-gray-700 ml-auto flex-shrink-0">
                            ({fn.inputs.length})
                          </span>
                        )}
                        {hasResult && !isBusy && (
                          <span className={`w-1 h-1 rounded-full ml-auto flex-shrink-0 ${
                            callResults[fn.signature].success ? "bg-green-500" : "bg-red-500"
                          }`} />
                        )}
                      </button>
                    );
                  })}
                  {filteredFunctions.length === 0 && (
                    <p className="text-gray-600 text-[11px] px-3 py-4 text-center">
                      No functions
                    </p>
                  )}
                </div>

                {/* Function detail + inputs + result */}
                <div className="flex-1 overflow-y-auto">
                  {selectedFunction ? (
                    <FunctionDetail
                      fn={selectedFunction}
                      inputValues={inputValues}
                      payableValue={payableValue}
                      callResult={currentFnResult}
                      calling={isCurrentFnCalling}
                      hasAddress={!!currentAddress}
                      chainId={chainId}
                      onInputChange={handleInputChange}
                      onPayableChange={setPayableValue}
                      onCall={handleCall}
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <p className="text-gray-600 text-[12px]">Select a function to interact</p>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-gray-600 text-sm">Select a contract from the list</p>
            </div>
          )}
        </div>

        {/* ─── Right Panel: Activity Log + Events ──────── */}
        <div className="w-80 flex-shrink-0 border-l border-white/[0.06] flex flex-col">
          {/* Events lookup */}
          <div className="px-3 py-3 border-b border-white/[0.06]">
            <label className="text-[10px] text-gray-600 uppercase tracking-wider mb-1.5 block">
              Event Lookup
            </label>
            <div className="flex gap-1.5">
              <input
                className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-[11px] text-white font-mono placeholder-gray-600 focus:outline-none focus:border-blue-500/50"
                placeholder="Tx hash 0x..."
                value={txHashInput}
                onChange={(e) => setTxHashInput(e.target.value)}
                spellCheck={false}
              />
              <button
                onClick={() => handleFetchEvents()}
                disabled={!txHashInput || !selectedContract || !currentAddress || loadingEvents}
                className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 disabled:opacity-30 transition-colors"
              >
                {loadingEvents ? "..." : "Decode"}
              </button>
            </div>
          </div>

          {/* Events */}
          {txEvents.length > 0 && (
            <div className="px-3 py-2 border-b border-white/[0.06] max-h-[250px] overflow-y-auto">
              <EventViewer events={txEvents} loading={loadingEvents} />
            </div>
          )}

          {/* Activity log header */}
          <div className="px-3 py-2 flex items-center justify-between border-b border-white/[0.06]">
            <span className="text-[10px] text-gray-600 uppercase tracking-wider">
              Activity Log
            </span>
            {activityLog.length > 0 && (
              <button
                onClick={clearLog}
                className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
              >
                Clear
              </button>
            )}
          </div>

          {/* Activity log */}
          <div className="flex-1 overflow-y-auto px-3 py-2">
            {activityLog.length === 0 ? (
              <p className="text-gray-700 text-[11px] text-center py-6">
                No activity yet
              </p>
            ) : (
              <div className="space-y-1.5">
                {activityLog.map((entry) => (
                  <ActivityEntry key={entry.id} entry={entry} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Address Modal (all contracts) ─────────────── */}
      {showAddressModal && (
        <ContractAddressModal
          contracts={contracts}
          networks={networks}
          selectedNetwork={selectedNetwork}
          onSave={saveAddress}
          onClose={() => setShowAddressModal(false)}
          onCheckProxy={checkProxy}
        />
      )}

      {/* ─── Deploy Modal ──────────────────────────────── */}
      {showDeployModal && (
        <DeployModal
          contract={showDeployModal}
          networks={networks}
          selectedNetwork={selectedNetwork}
          socket={socket}
          chainId={chainId}
          onClose={() => setShowDeployModal(null)}
          onDeployed={(contractName, network, address) => {
            saveAddress(contractName, network, address);
            setShowDeployModal(null);
          }}
        />
      )}
    </>
  );
}

// ─── Deploy Modal ───────────────────────────────────────────────

function DeployModal({
  contract,
  networks,
  selectedNetwork,
  socket,
  chainId,
  onClose,
  onDeployed,
}: {
  contract: ContractInfo;
  networks: NetworkInfo[];
  selectedNetwork: string;
  socket: Socket | null;
  chainId: number;
  onClose: () => void;
  onDeployed: (contractName: string, network: string, address: string) => void;
}) {
  // Extract constructor from ABI
  const constructor = contract.abi.find((entry: any) => entry.type === "constructor");
  const constructorInputs: ABIParam[] = constructor?.inputs?.map((p: any) => ({
    name: p.name || "",
    type: p.type,
    components: p.components,
    internalType: p.internalType,
  })) || [];
  const isPayable = constructor?.stateMutability === "payable";

  const [network, setNetwork] = useState(selectedNetwork);
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [payableValue, setPayableValue] = useState("0");
  const [deploying, setDeploying] = useState(false);
  const [result, setResult] = useState<{ success: boolean; address?: string; txHash?: string; error?: string } | null>(null);

  const handleDeploy = async () => {
    if (!socket) {
      setResult({ success: false, error: "Not connected to server" });
      return;
    }

    setDeploying(true);
    setResult(null);

    try {
      const args = constructorInputs.map((param, i) => {
        const key = param.name || `arg${i}`;
        const raw = inputValues[key] || "";
        return parseInputValue(param.type, raw);
      });

      const res = await fetch("/api/contract/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractName: contract.contractName,
          abi: contract.abi,
          args,
          networkName: network,
          value: isPayable ? payableValue : "0",
        }),
      });

      // Handle non-JSON responses (e.g. 404 HTML from old build)
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        setResult({
          success: false,
          error: "Server endpoint not available. Rebuild the plugin: cd packages/plugin && npm run build, then restart the server.",
        });
        return;
      }

      const data = await res.json();
      setResult(data);

      if (data.success && data.address) {
        onDeployed(contract.contractName, network, data.address);
      }
    } catch (err: any) {
      setResult({ success: false, error: err.message });
    } finally {
      setDeploying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass rounded-2xl w-[480px] max-h-[80vh] overflow-y-auto border border-white/[0.08] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div>
            <h2 className="text-white text-sm font-semibold">Deploy Contract</h2>
            <p className="text-gray-500 text-[11px] mt-0.5">{contract.contractName}</p>
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

        <div className="px-5 py-4 space-y-4">
          {/* Network selector */}
          <div>
            <label className="text-[11px] text-gray-500 mb-1.5 block">Deploy to Network</label>
            <div className="flex flex-wrap gap-1.5">
              {networks.map((net) => (
                <button
                  key={net.name}
                  onClick={() => setNetwork(net.name)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                    network === net.name
                      ? "bg-orange-500/20 text-orange-400 border border-orange-500/30"
                      : "bg-white/[0.04] text-gray-500 border border-white/[0.08] hover:border-white/[0.12]"
                  }`}
                >
                  {net.name}
                </button>
              ))}
            </div>
          </div>

          {/* Constructor params */}
          {constructorInputs.length > 0 ? (
            <div>
              <label className="text-[11px] text-gray-500 mb-2 block">Constructor Parameters</label>
              <div className="space-y-3">
                {constructorInputs.map((param, i) => {
                  const key = param.name || `arg${i}`;
                  return (
                    <SolidityInput
                      key={key}
                      param={param}
                      value={inputValues[key] || ""}
                      onChange={(v) => setInputValues((prev) => ({ ...prev, [key]: v }))}
                      disabled={deploying}
                    />
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-gray-600 text-[11px]">No constructor parameters required.</p>
          )}

          {/* Payable value */}
          {isPayable && (
            <div>
              <label className="text-[11px] text-orange-400 mb-1 block">
                ETH Value (in wei)
              </label>
              <input
                className="w-full bg-white/[0.04] border border-orange-500/20 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-gray-600 focus:outline-none focus:border-orange-500/40 focus:ring-1 focus:ring-orange-500/20"
                placeholder="0"
                value={payableValue}
                onChange={(e) => setPayableValue(e.target.value)}
                disabled={deploying}
              />
            </div>
          )}

          {/* Deploy button */}
          <button
            onClick={handleDeploy}
            disabled={deploying}
            className="w-full py-2.5 rounded-xl text-sm font-medium bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-40 transition-colors"
          >
            {deploying ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Deploying...
              </span>
            ) : (
              `Deploy ${contract.contractName} to ${network}`
            )}
          </button>

          {/* Result */}
          {result && (
            <div className={`rounded-xl border overflow-hidden ${
              result.success
                ? "bg-green-500/5 border-green-500/20"
                : "bg-red-500/5 border-red-500/20"
            }`}>
              {result.success ? (
                <div className="p-3">
                  <div className="flex items-center gap-1.5 mb-2">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#30d158" strokeWidth="2.5">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    <span className="text-green-400 text-[11px] font-medium">Transaction Sent!</span>
                  </div>
                  {result.txHash && (
                    <DeployTxDisplay txHash={result.txHash} chainId={chainId} />
                  )}
                  {result.address && (
                    <div className="mt-2 bg-white/[0.03] rounded-lg px-3 py-2 border border-white/[0.06]">
                      <p className="text-[10px] text-gray-500 mb-1">Contract Address</p>
                      <p className="text-white text-[12px] font-mono break-all">{result.address}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ff453a" strokeWidth="2.5">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M15 9l-6 6M9 9l6 6" />
                    </svg>
                    <span className="text-red-400 text-[11px] font-medium">Failed</span>
                  </div>
                  <p className="text-red-300 text-[12px] font-mono break-all">{result.error}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Function Detail Panel ──────────────────────────────────────

function FunctionDetail({
  fn,
  inputValues,
  payableValue,
  callResult,
  calling,
  hasAddress,
  chainId,
  onInputChange,
  onPayableChange,
  onCall,
}: {
  fn: ABIFunction;
  inputValues: Record<string, string>;
  payableValue: string;
  callResult: { success: boolean; result?: any; error?: string; txHash?: string; events?: DecodedEvent[] } | null;
  calling: boolean;
  hasAddress: boolean;
  chainId: number;
  onInputChange: (name: string, value: string) => void;
  onPayableChange: (value: string) => void;
  onCall: () => void;
}) {
  const isRead = fn.stateMutability === "view" || fn.stateMutability === "pure";

  return (
    <div className="p-4 space-y-4">
      {/* Function header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
            isRead
              ? "bg-green-500/15 text-green-400"
              : fn.payable
                ? "bg-orange-500/15 text-orange-400"
                : "bg-blue-500/15 text-blue-400"
          }`}>
            {fn.stateMutability}
          </span>
          <h4 className="text-white text-[14px] font-semibold font-mono">{fn.name}</h4>
        </div>
        {fn.outputs.length > 0 && (
          <p className="text-gray-600 text-[11px] ml-1">
            Returns: {fn.outputs.map((o) => `${o.type}${o.name ? ` ${o.name}` : ""}`).join(", ")}
          </p>
        )}
      </div>

      {/* Inputs */}
      {fn.inputs.length > 0 && (
        <div className="space-y-3">
          {fn.inputs.map((param, i) => {
            const key = param.name || `arg${i}`;
            return (
              <SolidityInput
                key={key}
                param={param}
                value={inputValues[key] || ""}
                onChange={(v) => onInputChange(key, v)}
                disabled={calling}
              />
            );
          })}
        </div>
      )}

      {/* Payable value */}
      {fn.payable && (
        <div>
          <label className="text-[11px] text-orange-400 mb-1 block">
            ETH Value (in wei)
          </label>
          <input
            className="w-full bg-white/[0.04] border border-orange-500/20 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-gray-600 focus:outline-none focus:border-orange-500/40 focus:ring-1 focus:ring-orange-500/20"
            placeholder="0"
            value={payableValue}
            onChange={(e) => onPayableChange(e.target.value)}
            disabled={calling}
          />
        </div>
      )}

      {/* Call button */}
      <button
        onClick={onCall}
        disabled={calling || !hasAddress}
        className={`w-full py-2.5 rounded-xl text-sm font-medium transition-colors ${
          isRead
            ? "bg-green-500/20 text-green-400 hover:bg-green-500/30 disabled:opacity-30"
            : "bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-30"
        }`}
      >
        {calling ? (
          <span className="flex items-center justify-center gap-2">
            <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
            {isRead ? "Reading..." : "Sending..."}
          </span>
        ) : !hasAddress ? (
          "Set address first"
        ) : isRead ? (
          `Read ${fn.name}`
        ) : (
          `Write ${fn.name}`
        )}
      </button>

      {/* Result */}
      {callResult && (
        <div className={`rounded-xl border overflow-hidden ${
          callResult.success
            ? "bg-green-500/5 border-green-500/20"
            : "bg-red-500/5 border-red-500/20"
        }`}>
          {/* Status header */}
          <div className="flex items-center gap-1.5 px-3 pt-3 pb-2">
            {callResult.success ? (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#30d158" strokeWidth="2.5">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                <span className="text-green-400 text-[11px] font-medium">Success</span>
              </>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ff453a" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M15 9l-6 6M9 9l6 6" />
                </svg>
                <span className="text-red-400 text-[11px] font-medium">Error</span>
              </>
            )}
          </div>

          {/* Transaction hash with explorer link (for write calls) */}
          {callResult.txHash && (
            <TxHashDisplay txHash={callResult.txHash} chainId={chainId} />
          )}

          {/* Read result */}
          {callResult.success && !callResult.txHash && callResult.result !== undefined && (
            <div className="px-3 pb-3">
              <ResultDisplay value={callResult.result} />
            </div>
          )}

          {/* Error message */}
          {callResult.error && (
            <div className="px-3 pb-3">
              <p className="text-red-300 text-[12px] font-mono break-all">{callResult.error}</p>
            </div>
          )}

          {/* Decoded events from this write call */}
          {callResult.events && callResult.events.length > 0 && (
            <div className="border-t border-white/[0.06] px-3 py-2.5">
              <p className="text-gray-500 text-[10px] uppercase tracking-wider mb-2">
                Emitted Events ({callResult.events.length})
              </p>
              <EventViewer events={callResult.events} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tx Hash Display ────────────────────────────────────────────

function TxHashDisplay({ txHash, chainId }: { txHash: string; chainId: number }) {
  const [copied, setCopied] = useState(false);
  const explorerUrl = getExplorerTxUrl(chainId, txHash);

  const handleCopy = () => {
    navigator.clipboard.writeText(txHash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="px-3 pb-3">
      <div className="flex items-center gap-2 bg-white/[0.03] rounded-lg px-3 py-2 border border-white/[0.06]">
        {/* Hash */}
        <span className="text-white text-[12px] font-mono">{shortHash(txHash)}</span>

        {/* Copy button */}
        <button
          onClick={handleCopy}
          className="p-1 rounded hover:bg-white/[0.06] transition-colors group"
          title="Copy full hash"
        >
          {copied ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#30d158" strokeWidth="2">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-600 group-hover:text-gray-400">
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
          )}
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Explorer link */}
        {explorerUrl && (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 px-2 py-1 rounded-md bg-blue-500/10 text-blue-400 text-[11px] font-medium hover:bg-blue-500/20 transition-colors"
          >
            View on Explorer
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
            </svg>
          </a>
        )}
      </div>
    </div>
  );
}

// ─── Deploy Tx Display (reuses the same pattern) ────────────────

function DeployTxDisplay({ txHash, chainId }: { txHash: string; chainId: number }) {
  const [copied, setCopied] = useState(false);
  const explorerUrl = getExplorerTxUrl(chainId, txHash);

  const handleCopy = () => {
    navigator.clipboard.writeText(txHash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center gap-2 bg-white/[0.03] rounded-lg px-3 py-2 border border-white/[0.06]">
      <span className="text-white text-[12px] font-mono">{shortHash(txHash)}</span>
      <button
        onClick={handleCopy}
        className="p-1 rounded hover:bg-white/[0.06] transition-colors group"
        title="Copy full hash"
      >
        {copied ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#30d158" strokeWidth="2">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-600 group-hover:text-gray-400">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
          </svg>
        )}
      </button>
      <div className="flex-1" />
      {explorerUrl && (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 px-2 py-1 rounded-md bg-blue-500/10 text-blue-400 text-[11px] font-medium hover:bg-blue-500/20 transition-colors"
        >
          View on Explorer
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
          </svg>
        </a>
      )}
    </div>
  );
}

// ─── Result Display ─────────────────────────────────────────────

function ResultDisplay({ value }: { value: any }) {
  if (value === null || value === undefined) {
    return <p className="text-gray-500 text-[12px] font-mono">void</p>;
  }

  if (typeof value === "object") {
    return (
      <pre className="text-gray-300 text-[11px] font-mono bg-white/[0.03] rounded-lg p-2 overflow-x-auto whitespace-pre-wrap break-all">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }

  return (
    <p className="text-white text-[12px] font-mono break-all">{String(value)}</p>
  );
}

// ─── Activity Entry ─────────────────────────────────────────────

function ActivityEntry({ entry }: { entry: ActivityLogEntry }) {
  const time = new Date(entry.timestamp).toLocaleTimeString();

  const typeColors = {
    read: "text-green-400",
    write: "text-blue-400",
    event: "text-purple-400",
    error: "text-red-400",
  };

  const typeIcons = {
    read: "↓",
    write: "↑",
    event: "◆",
    error: "✕",
  };

  return (
    <div className="bg-white/[0.02] rounded-lg px-2.5 py-2 border border-white/[0.04]">
      <div className="flex items-center gap-1.5">
        <span className={`text-[10px] ${typeColors[entry.type]}`}>
          {typeIcons[entry.type]}
        </span>
        <span className="text-white text-[11px] font-medium truncate">
          {entry.contractName}.{entry.functionName}
        </span>
        <span className="text-gray-700 text-[10px] ml-auto flex-shrink-0">{time}</span>
      </div>
      {entry.result !== undefined && (
        <p className="text-gray-500 text-[10px] font-mono mt-1 truncate">
          {typeof entry.result === "object" ? JSON.stringify(entry.result) : String(entry.result)}
        </p>
      )}
      {entry.error && (
        <p className="text-red-400/70 text-[10px] mt-1 truncate">{entry.error}</p>
      )}
      {entry.txHash && (
        <p className="text-gray-600 text-[10px] font-mono mt-0.5 truncate">{entry.txHash}</p>
      )}
    </div>
  );
}

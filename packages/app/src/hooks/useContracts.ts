/**
 * useContracts — hook for the Contract Interaction UI.
 *
 * Fetches contract list + addresses from the backend, and exposes
 * executeRead, fetchEvents, saveAddress, checkProxy, and rescan methods.
 */

import { useState, useEffect, useCallback } from "react";
import type {
  ContractInfo,
  ReadCallResult,
  EventsResult,
  ProxyCheckResult,
  ActivityLogEntry,
  NetworkInfo,
} from "../types";

export function useContracts() {
  const [contracts, setContracts] = useState<ContractInfo[]>([]);
  const [networks, setNetworks] = useState<NetworkInfo[]>([]);
  const [addresses, setAddresses] = useState<Record<string, Record<string, string>>>({});
  const [loading, setLoading] = useState(true);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);

  // ─── Fetch contracts + networks on mount ────────────────────────

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [contractsRes, addressesRes, networksRes] = await Promise.all([
        fetch("/api/contracts").then((r) => r.json()),
        fetch("/api/contracts/addresses").then((r) => r.json()),
        fetch("/api/networks").then((r) => r.json()),
      ]);
      setContracts(contractsRes.contracts || []);
      setAddresses(addressesRes.addresses || {});
      setNetworks(networksRes.networks || []);
    } catch (err) {
      console.error("[Contracts] Failed to fetch data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ─── Add to activity log ────────────────────────────────────────

  const addLog = useCallback((entry: Omit<ActivityLogEntry, "id" | "timestamp">) => {
    setActivityLog((prev) => [
      {
        ...entry,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
      },
      ...prev,
    ].slice(0, 200)); // keep last 200
  }, []);

  // ─── Execute a read-only call ───────────────────────────────────

  const executeRead = useCallback(
    async (
      contractAddress: string,
      abi: any[],
      functionName: string,
      args: any[],
      networkName: string,
      contractName: string
    ): Promise<ReadCallResult> => {
      try {
        const res = await fetch("/api/contract/read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contractAddress, abi, functionName, args, networkName }),
        });
        const data = await res.json();

        addLog({
          type: data.success ? "read" : "error",
          contractName,
          functionName,
          args,
          result: data.result,
          error: data.error,
        });

        return data;
      } catch (err: any) {
        const result = { success: false, error: err.message };
        addLog({
          type: "error",
          contractName,
          functionName,
          args,
          error: err.message,
        });
        return result;
      }
    },
    [addLog]
  );

  // ─── Fetch events from a transaction ────────────────────────────

  const fetchEvents = useCallback(
    async (
      contractAddress: string,
      abi: any[],
      txHash: string,
      networkName: string,
      contractName: string
    ): Promise<EventsResult> => {
      try {
        const res = await fetch("/api/contract/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contractAddress, abi, txHash, networkName }),
        });
        const data = await res.json();

        if (data.success && data.events) {
          for (const evt of data.events) {
            addLog({
              type: "event",
              contractName,
              functionName: evt.name,
              result: evt.args,
              txHash,
            });
          }
        }

        return data;
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
    [addLog]
  );

  // ─── Execute a write (state-changing) call ──────────────────────

  const executeWrite = useCallback(
    async (
      contractAddress: string,
      abi: any[],
      functionName: string,
      args: any[],
      networkName: string,
      contractName: string,
      value?: string
    ): Promise<{ success: boolean; txHash?: string; error?: string }> => {
      try {
        const res = await fetch("/api/contract/write", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contractAddress,
            abi,
            functionName,
            args,
            networkName,
            value: value || "0",
          }),
        });

        if (!res.ok && res.headers.get("content-type")?.includes("text/html")) {
          const error = "Server returned HTML — rebuild the plugin (npm run build in packages/plugin)";
          addLog({ type: "error", contractName, functionName, args, error });
          return { success: false, error };
        }

        const data = await res.json();

        addLog({
          type: data.success ? "write" : "error",
          contractName,
          functionName,
          args,
          txHash: data.txHash,
          result: data.txHash ? `tx: ${data.txHash}` : undefined,
          error: data.error,
        });

        // Auto-fetch events if we got a tx hash
        if (data.success && data.txHash) {
          // Small delay to let the tx confirm, then fetch events
          setTimeout(async () => {
            try {
              const eventsRes = await fetch("/api/contract/events", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  contractAddress,
                  abi,
                  txHash: data.txHash,
                  networkName,
                }),
              });
              const eventsData = await eventsRes.json();
              if (eventsData.success && eventsData.events) {
                for (const evt of eventsData.events) {
                  addLog({
                    type: "event",
                    contractName,
                    functionName: evt.name,
                    result: evt.args,
                    txHash: data.txHash,
                  });
                }
              }
            } catch {
              // silently ignore event fetch failures
            }
          }, 3000);
        }

        return data;
      } catch (err: any) {
        const error = err.message;
        addLog({ type: "error", contractName, functionName, args, error });
        return { success: false, error };
      }
    },
    [addLog]
  );

  // ─── Save address ───────────────────────────────────────────────

  const saveAddress = useCallback(
    async (contractName: string, networkName: string, address: string) => {
      try {
        await fetch("/api/contracts/addresses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contractName, networkName, address }),
        });

        // Update local state
        setAddresses((prev) => ({
          ...prev,
          [contractName]: {
            ...(prev[contractName] || {}),
            [networkName]: address,
          },
        }));

        // Update contracts list too
        setContracts((prev) =>
          prev.map((c) =>
            c.contractName === contractName
              ? { ...c, deployedAddresses: { ...c.deployedAddresses, [networkName]: address } }
              : c
          )
        );
      } catch (err) {
        console.error("[Contracts] Failed to save address:", err);
      }
    },
    []
  );

  // ─── Check proxy ────────────────────────────────────────────────

  const checkProxy = useCallback(
    async (contractAddress: string, networkName: string): Promise<ProxyCheckResult> => {
      try {
        const res = await fetch("/api/contract/proxy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contractAddress, networkName }),
        });
        return await res.json();
      } catch {
        return { isProxy: false };
      }
    },
    []
  );

  // ─── Rescan artifacts ───────────────────────────────────────────

  const rescan = useCallback(async () => {
    try {
      await fetch("/api/contracts/rescan", { method: "POST" });
      await fetchData();
    } catch (err) {
      console.error("[Contracts] Failed to rescan:", err);
    }
  }, [fetchData]);

  // ─── Clear log ──────────────────────────────────────────────────

  const clearLog = useCallback(() => {
    setActivityLog([]);
  }, []);

  return {
    contracts,
    networks,
    addresses,
    loading,
    activityLog,
    executeRead,
    executeWrite,
    fetchEvents,
    saveAddress,
    checkProxy,
    rescan,
    clearLog,
    refresh: fetchData,
  };
}

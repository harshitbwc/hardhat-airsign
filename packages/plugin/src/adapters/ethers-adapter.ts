/**
 * Ethers Adapter — thin abstraction layer over ethers.js APIs.
 *
 * This adapter isolates all direct ethers imports so that:
 * - v1 (ethers v5) and v2 (ethers v6) share the same ContractService code
 * - Only this file needs to change when migrating to ethers v6
 *
 * All other service files (ContractService, SigningServer) import from here.
 */

import { ethers } from "ethers";

// ─── Provider ─────────────────────────────────────────────────────

export function createProvider(rpcUrl: string): ethers.providers.JsonRpcProvider {
  return new ethers.providers.JsonRpcProvider(rpcUrl);
}

export type EthersProvider = ethers.providers.JsonRpcProvider;

// ─── Contract ─────────────────────────────────────────────────────

export function createContract(
  address: string,
  abi: any[],
  providerOrSigner: ethers.providers.Provider | ethers.Signer
): ethers.Contract {
  return new ethers.Contract(address, abi, providerOrSigner);
}

export type EthersContract = ethers.Contract;

// ─── Interface (ABI encoding/decoding) ────────────────────────────

export function createInterface(abi: any[]): ethers.utils.Interface {
  return new ethers.utils.Interface(abi);
}

export type EthersInterface = ethers.utils.Interface;

/**
 * Parse a single log entry using an Interface.
 * Returns null if the log can't be decoded (unknown event).
 */
export function parseLog(
  iface: ethers.utils.Interface,
  log: { topics: string[]; data: string }
): ethers.utils.LogDescription | null {
  try {
    return iface.parseLog(log);
  } catch {
    return null;
  }
}

// ─── Transaction Receipt ──────────────────────────────────────────

export async function getTransactionReceipt(
  provider: ethers.providers.JsonRpcProvider,
  txHash: string
): Promise<ethers.providers.TransactionReceipt | null> {
  return provider.getTransactionReceipt(txHash);
}

// ─── Storage Read (for proxy detection) ───────────────────────────

export async function getStorageAt(
  provider: ethers.providers.JsonRpcProvider,
  address: string,
  slot: string
): Promise<string> {
  return provider.getStorageAt(address, slot);
}

// ─── Utilities ────────────────────────────────────────────────────

export function isAddress(value: string): boolean {
  try {
    ethers.utils.getAddress(value);
    return true;
  } catch {
    return false;
  }
}

export function getAddress(value: string): string {
  return ethers.utils.getAddress(value);
}

/**
 * Serialize a contract call result to a JSON-safe format.
 * Handles BigNumber, arrays, and nested structures.
 */
export function serializeResult(value: any): any {
  if (value === null || value === undefined) return value;

  // BigNumber → string
  if (ethers.BigNumber.isBigNumber(value)) {
    return value.toString();
  }

  // Array (including Result objects from ethers)
  if (Array.isArray(value)) {
    // ethers Result objects have both numeric and named keys.
    // If it has named keys, return as object with named keys only.
    const result: any = {};
    let hasNamedKeys = false;
    for (const key of Object.keys(value)) {
      if (isNaN(Number(key))) {
        hasNamedKeys = true;
        result[key] = serializeResult((value as any)[key]);
      }
    }
    if (hasNamedKeys) return result;

    // Plain array
    return value.map(serializeResult);
  }

  // Plain object
  if (typeof value === "object") {
    const result: any = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = serializeResult(v);
    }
    return result;
  }

  // Primitives (string, number, boolean)
  return value;
}

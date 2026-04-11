/**
 * ContractService — handles contract artifact discovery, ABI parsing,
 * deployment address detection, read-only function execution, and event decoding.
 *
 * This service is version-agnostic — it uses the ethers adapter for all
 * blockchain interactions, making it work with both ethers v5 (airsign v1)
 * and ethers v6 (airsign v2).
 */

import path from "path";
import fs from "fs";
import {
  createProvider,
  createContract,
  createInterface,
  parseLog,
  getTransactionReceipt,
  getStorageAt,
  isAddress,
  getAddress,
  serializeResult,
} from "./adapters/ethers-adapter";
import { NetworkInfo } from "./types";

// ─── Types ────────────────────────────────────────────────────────

export interface ABIParam {
  name: string;
  type: string;
  components?: ABIParam[];
  indexed?: boolean;
  internalType?: string;
}

export interface ABIFunction {
  name: string;
  signature: string;
  stateMutability: "view" | "pure" | "nonpayable" | "payable";
  inputs: ABIParam[];
  outputs: ABIParam[];
  payable: boolean;
}

export interface ABIEvent {
  name: string;
  signature: string;
  inputs: ABIParam[];
}

export interface ContractInfo {
  contractName: string;
  sourceName: string;
  abi: any[];
  functions: {
    read: ABIFunction[];
    write: ABIFunction[];
  };
  events: ABIEvent[];
  /** Auto-detected deployed addresses: networkName → address */
  deployedAddresses: Record<string, string>;
}

export interface DecodedEvent {
  name: string;
  signature: string;
  args: Record<string, any>;
  logIndex: number;
  address: string;
}

export interface ReadCallRequest {
  contractAddress: string;
  abi: any[];
  functionName: string;
  args: any[];
  networkName: string;
}

export interface ReadCallResponse {
  success: boolean;
  result?: any;
  error?: string;
}

export interface EventsRequest {
  contractAddress: string;
  abi: any[];
  txHash: string;
  networkName: string;
}

export interface EventsResponse {
  success: boolean;
  events?: DecodedEvent[];
  error?: string;
}

// ERC-1967 implementation slot
const ERC1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

// ERC-1967 beacon slot
const ERC1967_BEACON_SLOT =
  "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";

// ERC-1967 admin slot
const ERC1967_ADMIN_SLOT =
  "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";

// ─── ContractService ──────────────────────────────────────────────

export class ContractService {
  private projectRoot: string;
  private networks: NetworkInfo[];
  private contracts: ContractInfo[] = [];
  /** User-configured addresses: contractName → (networkName → address) */
  private userAddresses: Record<string, Record<string, string>> = {};
  private addressFilePath: string;

  constructor(projectRoot: string, networks: NetworkInfo[]) {
    this.projectRoot = projectRoot;
    this.networks = networks;
    this.addressFilePath = path.join(projectRoot, ".airsign-addresses.json");
    this.loadUserAddresses();
  }

  // ─── Initialization ───────────────────────────────────────────

  /**
   * Scan artifacts directory and build the contract list.
   * Call this once on server start.
   */
  async scanArtifacts(): Promise<void> {
    const artifactsDir = path.join(this.projectRoot, "artifacts");
    if (!fs.existsSync(artifactsDir)) {
      console.log("  ℹ️  No artifacts/ directory found. Compile contracts first.");
      this.contracts = [];
      return;
    }

    const artifacts = this.findArtifactFiles(artifactsDir);
    this.contracts = [];

    for (const artifactPath of artifacts) {
      try {
        const raw = fs.readFileSync(artifactPath, "utf-8");
        const artifact = JSON.parse(raw);

        // Skip non-contract artifacts (no ABI or no bytecode)
        if (!artifact.abi || !Array.isArray(artifact.abi) || artifact.abi.length === 0) {
          continue;
        }

        // Skip interfaces and abstract contracts (no deployable bytecode)
        if (
          !artifact.bytecode ||
          artifact.bytecode === "0x" ||
          artifact.bytecode === ""
        ) {
          continue;
        }

        const contractName = artifact.contractName;
        const sourceName = artifact.sourceName || "";

        // Parse ABI
        const functions = this.parseFunctions(artifact.abi);
        const events = this.parseEvents(artifact.abi);

        // Skip contracts with no functions (pure event-only contracts)
        if (functions.read.length === 0 && functions.write.length === 0) {
          continue;
        }

        // Auto-detect deployed addresses
        const deployedAddresses = this.detectDeployedAddresses(contractName);

        // Merge user-configured addresses (they override auto-detected)
        const userAddrs = this.userAddresses[contractName] || {};
        const mergedAddresses = { ...deployedAddresses, ...userAddrs };

        this.contracts.push({
          contractName,
          sourceName,
          abi: artifact.abi,
          functions,
          events,
          deployedAddresses: mergedAddresses,
        });
      } catch (err) {
        // Skip malformed artifacts
        continue;
      }
    }

    console.log(`  📜 Found ${this.contracts.length} contracts with functions`);
  }

  // ─── Public API ───────────────────────────────────────────────

  /**
   * Get all discovered contracts.
   */
  getContracts(): ContractInfo[] {
    return this.contracts;
  }

  /**
   * Get saved contract addresses (merged: auto-detected + user-configured).
   */
  getAddresses(): Record<string, Record<string, string>> {
    const result: Record<string, Record<string, string>> = {};
    for (const contract of this.contracts) {
      result[contract.contractName] = { ...contract.deployedAddresses };
    }
    return result;
  }

  /**
   * Save a contract address for a specific network.
   */
  saveAddress(contractName: string, networkName: string, address: string): void {
    if (!this.userAddresses[contractName]) {
      this.userAddresses[contractName] = {};
    }
    this.userAddresses[contractName][networkName] = address;

    // Update the in-memory contract info
    const contract = this.contracts.find((c) => c.contractName === contractName);
    if (contract) {
      contract.deployedAddresses[networkName] = address;
    }

    // Persist to disk
    this.persistUserAddresses();
  }

  /**
   * Execute a read-only (view/pure) function call.
   */
  async executeReadCall(request: ReadCallRequest): Promise<ReadCallResponse> {
    const { contractAddress, abi, functionName, args, networkName } = request;

    // Validate address
    if (!isAddress(contractAddress)) {
      return { success: false, error: `Invalid contract address: ${contractAddress}` };
    }

    // Find network RPC URL
    const network = this.networks.find((n) => n.name === networkName);
    if (!network || !network.url) {
      return { success: false, error: `Network "${networkName}" not found or has no RPC URL` };
    }

    try {
      const provider = createProvider(network.url);
      const contract = createContract(contractAddress, abi, provider);

      // Check function exists
      if (typeof contract[functionName] !== "function") {
        return { success: false, error: `Function "${functionName}" not found on contract` };
      }

      const result = await contract[functionName](...args);
      return { success: true, result: serializeResult(result) };
    } catch (err: any) {
      // Try to decode revert reason
      const reason = this.decodeRevertReason(err);
      return { success: false, error: reason || err.message };
    }
  }

  /**
   * Fetch and decode events from a transaction receipt.
   */
  async fetchEvents(request: EventsRequest): Promise<EventsResponse> {
    const { contractAddress, abi, txHash, networkName } = request;

    const network = this.networks.find((n) => n.name === networkName);
    if (!network || !network.url) {
      return { success: false, error: `Network "${networkName}" not found or has no RPC URL` };
    }

    try {
      const provider = createProvider(network.url);
      const receipt = await getTransactionReceipt(provider, txHash);

      if (!receipt) {
        return { success: false, error: `Transaction receipt not found for ${txHash}` };
      }

      const iface = createInterface(abi);
      const decodedEvents: DecodedEvent[] = [];

      for (const log of receipt.logs) {
        // Only decode logs from the target contract (or all if address is zero)
        const logAddress = log.address.toLowerCase();
        const targetAddress = contractAddress.toLowerCase();

        if (logAddress !== targetAddress && contractAddress !== "0x") {
          continue;
        }

        const parsed = parseLog(iface, {
          topics: log.topics as string[],
          data: log.data,
        });

        if (parsed) {
          // Convert parsed args to a clean object
          const args: Record<string, any> = {};
          for (const key of Object.keys(parsed.args)) {
            if (isNaN(Number(key))) {
              args[key] = serializeResult(parsed.args[key]);
            }
          }

          decodedEvents.push({
            name: parsed.name,
            signature: parsed.signature,
            args,
            logIndex: log.logIndex,
            address: log.address,
          });
        }
      }

      return { success: true, events: decodedEvents };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Check if a contract address is an ERC-1967 proxy.
   * Returns the implementation address if it is, null otherwise.
   */
  async checkProxy(
    contractAddress: string,
    networkName: string
  ): Promise<{
    isProxy: boolean;
    implementationAddress?: string;
    adminAddress?: string;
    matchedContract?: string;
  }> {
    const network = this.networks.find((n) => n.name === networkName);
    if (!network || !network.url) {
      return { isProxy: false };
    }

    try {
      const provider = createProvider(network.url);

      // Check ERC-1967 implementation slot
      const implSlotValue = await getStorageAt(
        provider,
        contractAddress,
        ERC1967_IMPLEMENTATION_SLOT
      );

      // Parse address from slot (last 20 bytes of 32-byte slot)
      const implAddress = this.addressFromSlot(implSlotValue);

      if (!implAddress) {
        return { isProxy: false };
      }

      // Check admin slot
      const adminSlotValue = await getStorageAt(
        provider,
        contractAddress,
        ERC1967_ADMIN_SLOT
      );
      const adminAddress = this.addressFromSlot(adminSlotValue);

      // Try to match implementation address to a known compiled contract
      let matchedContract: string | undefined;
      for (const contract of this.contracts) {
        for (const [netName, addr] of Object.entries(contract.deployedAddresses)) {
          if (addr.toLowerCase() === implAddress.toLowerCase()) {
            matchedContract = contract.contractName;
            break;
          }
        }
        if (matchedContract) break;
      }

      return {
        isProxy: true,
        implementationAddress: implAddress,
        adminAddress: adminAddress || undefined,
        matchedContract,
      };
    } catch {
      return { isProxy: false };
    }
  }

  // ─── Private: Artifact Discovery ──────────────────────────────

  /**
   * Recursively find all artifact JSON files.
   * Skips .dbg.json files and build-info.
   */
  private findArtifactFiles(dir: string): string[] {
    const results: string[] = [];

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // Skip build-info directory
          if (entry.name === "build-info") continue;
          results.push(...this.findArtifactFiles(fullPath));
        } else if (
          entry.isFile() &&
          entry.name.endsWith(".json") &&
          !entry.name.endsWith(".dbg.json")
        ) {
          results.push(fullPath);
        }
      }
    } catch {
      // Permission errors or similar — skip
    }

    return results;
  }

  // ─── Private: ABI Parsing ─────────────────────────────────────

  /**
   * Parse function entries from an ABI into read (view/pure) and write groups.
   */
  private parseFunctions(abi: any[]): { read: ABIFunction[]; write: ABIFunction[] } {
    const read: ABIFunction[] = [];
    const write: ABIFunction[] = [];

    for (const entry of abi) {
      if (entry.type !== "function") continue;

      const inputs: ABIParam[] = (entry.inputs || []).map(this.parseParam);
      const outputs: ABIParam[] = (entry.outputs || []).map(this.parseParam);

      const signature = `${entry.name}(${inputs.map((i) => i.type).join(",")})`;

      const func: ABIFunction = {
        name: entry.name,
        signature,
        stateMutability: entry.stateMutability || "nonpayable",
        inputs,
        outputs,
        payable: entry.stateMutability === "payable",
      };

      if (
        entry.stateMutability === "view" ||
        entry.stateMutability === "pure"
      ) {
        read.push(func);
      } else {
        write.push(func);
      }
    }

    // Sort alphabetically
    read.sort((a, b) => a.name.localeCompare(b.name));
    write.sort((a, b) => a.name.localeCompare(b.name));

    return { read, write };
  }

  /**
   * Parse event entries from an ABI.
   */
  private parseEvents(abi: any[]): ABIEvent[] {
    const events: ABIEvent[] = [];

    for (const entry of abi) {
      if (entry.type !== "event") continue;

      const inputs: ABIParam[] = (entry.inputs || []).map(this.parseParam);
      const signature = `${entry.name}(${inputs.map((i) => i.type).join(",")})`;

      events.push({ name: entry.name, signature, inputs });
    }

    return events.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Parse a single ABI param (handles nested components for tuples).
   */
  private parseParam = (param: any): ABIParam => {
    const result: ABIParam = {
      name: param.name || "",
      type: param.type,
    };

    if (param.indexed) {
      result.indexed = true;
    }

    if (param.internalType) {
      result.internalType = param.internalType;
    }

    // Recursively parse tuple components
    if (param.components && Array.isArray(param.components)) {
      result.components = param.components.map(this.parseParam);
    }

    return result;
  };

  // ─── Private: Deployment Detection ────────────────────────────

  /**
   * Auto-detect deployed addresses from hardhat-deploy and hardhat-ignition.
   */
  private detectDeployedAddresses(contractName: string): Record<string, string> {
    const addresses: Record<string, string> = {};

    // 1. Check hardhat-deploy: deployments/<networkName>/<ContractName>.json
    const deploymentsDir = path.join(this.projectRoot, "deployments");
    if (fs.existsSync(deploymentsDir)) {
      try {
        const networkDirs = fs.readdirSync(deploymentsDir, { withFileTypes: true });
        for (const networkDir of networkDirs) {
          if (!networkDir.isDirectory()) continue;

          const deploymentFile = path.join(
            deploymentsDir,
            networkDir.name,
            `${contractName}.json`
          );

          if (fs.existsSync(deploymentFile)) {
            try {
              const deployment = JSON.parse(fs.readFileSync(deploymentFile, "utf-8"));
              if (deployment.address && isAddress(deployment.address)) {
                addresses[networkDir.name] = getAddress(deployment.address);
              }
            } catch {
              // Skip malformed deployment files
            }
          }
        }
      } catch {
        // Skip if can't read deployments dir
      }
    }

    // 2. Check hardhat-ignition: ignition/deployments/<module>/deployed_addresses.json
    const ignitionDir = path.join(this.projectRoot, "ignition", "deployments");
    if (fs.existsSync(ignitionDir)) {
      try {
        const moduleDirs = fs.readdirSync(ignitionDir, { withFileTypes: true });
        for (const moduleDir of moduleDirs) {
          if (!moduleDir.isDirectory()) continue;

          const addressesFile = path.join(
            ignitionDir,
            moduleDir.name,
            "deployed_addresses.json"
          );

          if (fs.existsSync(addressesFile)) {
            try {
              const deployedAddresses = JSON.parse(
                fs.readFileSync(addressesFile, "utf-8")
              );

              // Ignition format: { "ModuleName#ContractName": "0x..." }
              for (const [key, addr] of Object.entries(deployedAddresses)) {
                const parts = key.split("#");
                const deployedContractName = parts[parts.length - 1];

                if (
                  deployedContractName === contractName &&
                  typeof addr === "string" &&
                  isAddress(addr)
                ) {
                  // Extract network name from module dir (e.g., "chain-11155111")
                  const networkName = this.chainIdToNetworkName(moduleDir.name);
                  if (networkName) {
                    addresses[networkName] = getAddress(addr);
                  }
                }
              }
            } catch {
              // Skip malformed ignition files
            }
          }
        }
      } catch {
        // Skip if can't read ignition dir
      }
    }

    return addresses;
  }

  // ─── Private: Address Persistence ─────────────────────────────

  /**
   * Load user-configured addresses from .airsign-addresses.json
   */
  private loadUserAddresses(): void {
    try {
      if (fs.existsSync(this.addressFilePath)) {
        const raw = fs.readFileSync(this.addressFilePath, "utf-8");
        this.userAddresses = JSON.parse(raw);
      }
    } catch {
      this.userAddresses = {};
    }
  }

  /**
   * Save user-configured addresses to .airsign-addresses.json
   */
  private persistUserAddresses(): void {
    try {
      fs.writeFileSync(
        this.addressFilePath,
        JSON.stringify(this.userAddresses, null, 2),
        "utf-8"
      );
    } catch (err) {
      console.log("  ⚠️  Could not save contract addresses:", (err as any).message);
    }
  }

  // ─── Private: Helpers ─────────────────────────────────────────

  /**
   * Extract an address from a 32-byte storage slot value.
   * Returns null if the slot is empty (all zeros).
   */
  private addressFromSlot(slotValue: string): string | null {
    if (!slotValue || slotValue === "0x" + "0".repeat(64)) {
      return null;
    }

    // Address is the last 20 bytes (40 hex chars)
    const hex = slotValue.replace("0x", "").padStart(64, "0");
    const addressHex = "0x" + hex.slice(24);

    if (addressHex === "0x" + "0".repeat(40)) {
      return null;
    }

    try {
      return getAddress(addressHex);
    } catch {
      return null;
    }
  }

  /**
   * Try to map an ignition module directory name to a network name.
   * Ignition uses "chain-<chainId>" format.
   */
  private chainIdToNetworkName(dirName: string): string | null {
    const match = dirName.match(/^chain-(\d+)$/);
    if (!match) return dirName; // use as-is if not chain-ID format

    const chainId = parseInt(match[1], 10);

    // Find matching network in our config
    for (const network of this.networks) {
      if (network.chainId === chainId) {
        return network.name;
      }
    }

    // Fallback: well-known chain IDs
    const wellKnown: Record<number, string> = {
      1: "mainnet",
      5: "goerli",
      11155111: "sepolia",
      137: "polygon",
      80001: "polygonMumbai",
      42161: "arbitrum",
      421614: "arbitrumSepolia",
      10: "optimism",
      11155420: "optimismSepolia",
      8453: "base",
      84532: "baseSepolia",
      56: "bsc",
      43114: "avalanche",
      31337: "hardhat",
    };

    return wellKnown[chainId] || null;
  }

  /**
   * Try to decode a revert reason from an error.
   */
  private decodeRevertReason(err: any): string | null {
    // ethers v5 puts the reason in different places depending on the error type
    if (err.reason) return `Reverted: ${err.reason}`;
    if (err.error?.reason) return `Reverted: ${err.error.reason}`;
    if (err.error?.message) return err.error.message;

    // Try to decode from error data
    if (err.data) {
      try {
        // Standard Error(string) selector: 0x08c379a0
        if (typeof err.data === "string" && err.data.startsWith("0x08c379a0")) {
          const iface = createInterface(["function Error(string)"]);
          const decoded = iface.decodeFunctionData("Error", err.data);
          return `Reverted: ${decoded[0]}`;
        }
      } catch {
        // Can't decode, fall through
      }
    }

    return null;
  }
}

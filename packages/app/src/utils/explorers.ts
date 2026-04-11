/**
 * Block explorer URL mappings and helpers.
 * Shared between SigningQueue, ContractsTab, and other components.
 */

export const EXPLORERS: Record<number, string> = {
  1: "https://etherscan.io",
  5: "https://goerli.etherscan.io",
  11155111: "https://sepolia.etherscan.io",
  137: "https://polygonscan.com",
  80001: "https://mumbai.polygonscan.com",
  42161: "https://arbiscan.io",
  421614: "https://sepolia.arbiscan.io",
  10: "https://optimistic.etherscan.io",
  11155420: "https://sepolia-optimism.etherscan.io",
  8453: "https://basescan.org",
  84532: "https://sepolia.basescan.org",
  56: "https://bscscan.com",
  43114: "https://snowtrace.io",
  31337: "", // hardhat — no explorer
};

export function getExplorerTxUrl(chainId: number, hash: string): string | null {
  const base = EXPLORERS[chainId];
  if (!base) return null;
  return `${base}/tx/${hash}`;
}

export function getExplorerAddressUrl(chainId: number, address: string): string | null {
  const base = EXPLORERS[chainId];
  if (!base) return null;
  return `${base}/address/${address}`;
}

export function shortHash(h: string): string {
  if (!h) return "";
  return `${h.slice(0, 8)}...${h.slice(-6)}`;
}

export function shortAddress(a: string): string {
  if (!a) return "";
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

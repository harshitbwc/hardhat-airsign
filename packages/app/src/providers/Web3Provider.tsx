import React from "react";
import "@rainbow-me/rainbowkit/styles.css";
import {
  connectorsForWallets,
  RainbowKitProvider,
  darkTheme,
} from "@rainbow-me/rainbowkit";
import {
  metaMaskWallet,
  rainbowWallet,
  coinbaseWallet,
  walletConnectWallet,
  ledgerWallet,
  trustWallet,
  phantomWallet,
  braveWallet,
  safeWallet,
  rabbyWallet,
  zerionWallet,
  okxWallet,
  uniswapWallet,
  bitgetWallet,
  frameWallet,
  injectedWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http, WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  mainnet,
  sepolia,
  goerli,
  polygon,
  polygonMumbai,
  arbitrum,
  arbitrumSepolia,
  optimism,
  optimismSepolia,
  base,
  baseSepolia,
  bsc,
  avalanche,
  hardhat,
  localhost,
} from "wagmi/chains";

const projectId =
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ||
  "166a180f2c8191ed5f637bdcecef77d6";

const chains = [
  mainnet,
  sepolia,
  goerli,
  polygon,
  polygonMumbai,
  arbitrum,
  arbitrumSepolia,
  optimism,
  optimismSepolia,
  base,
  baseSepolia,
  bsc,
  avalanche,
  hardhat,
  localhost,
] as const;

const connectors = connectorsForWallets(
  [
    {
      groupName: "Popular",
      wallets: [
        metaMaskWallet,
        coinbaseWallet,
        walletConnectWallet,
        ledgerWallet,
        trustWallet,
        rabbyWallet,
        safeWallet,
      ],
    },
    {
      groupName: "More Wallets",
      wallets: [
        rainbowWallet,
        phantomWallet,
        braveWallet,
        zerionWallet,
        okxWallet,
        uniswapWallet,
        bitgetWallet,
        frameWallet,
        injectedWallet,
      ],
    },
  ],
  {
    appName: "Hardhat AirSign",
    projectId,
  }
);

const config = createConfig({
  connectors,
  chains,
  transports: Object.fromEntries(
    chains.map((chain) => [chain.id, http()])
  ) as any,
});

const queryClient = new QueryClient();

export function Web3Provider({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: "#3b82f6",
            accentColorForeground: "white",
            borderRadius: "medium",
          })}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

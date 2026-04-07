# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-04-07

### Added

- Remote transaction signing via browser wallet (MetaMask, Rainbow, Coinbase Wallet, WalletConnect)
- Background daemon mode with `airsign-start`, `airsign-stop`, `airsign-status` commands
- `RemoteSigner` — custom ethers.js v5 Signer that delegates signing to the browser
- Runner UI — execute Hardhat tasks and scripts from a 3-column browser interface
- Real-time console output streaming from Runner processes via Socket.io
- Signing modal overlay — approve transactions without leaving the Runner tab
- Multi-chain support (Ethereum, Sepolia, Polygon, Arbitrum, Optimism, Base, BSC, Avalanche, and more)
- RainbowKit wallet connection UI
- Transaction history within the session
- `remoteSigner: true` network config — zero code changes to existing deploy scripts

### Compatibility

- Hardhat v2 (`^2.0.0`)
- ethers.js v5 (`^5.0.0`) via `@nomiclabs/hardhat-ethers`
- Node.js >= 18

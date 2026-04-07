# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.1] - 2026-04-08

### Added

- Explicit support for 15+ wallets: MetaMask, Coinbase Wallet, Ledger, Trust Wallet, Rabby, Safe (Gnosis), Rainbow, Phantom, Brave, Zerion, OKX, Uniswap, Bitget, Frame, and any injected wallet
- Wallets are now grouped into "Popular" and "More Wallets" in the connect modal

### Fixed

- WalletConnect QR code flow now works out of the box with a default project ID
- Users can still override with `VITE_WALLETCONNECT_PROJECT_ID` env var if needed

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

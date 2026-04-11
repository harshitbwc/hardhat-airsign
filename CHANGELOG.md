# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [2.0.0] - 2026-04-11

### Added

- Integration test suite with vitest (25 tests covering RemoteSigner, SigningClient, and exports)
- GitHub Actions CI workflow (build + test on Node 18/20/22)
- `npm test` script in root and plugin package.json

### Changed

- Version scheme aligned with Hardhat: airsign v2.x = Hardhat v2, airsign v3.x = Hardhat v3
- `build:plugin` script no longer runs `npm install` (avoids corrupting hoisted node_modules in monorepo)

## [1.0.0] - 2026-04-11

### Added

- **Contracts UI** — new Contracts tab for interacting with deployed contracts directly from the browser
  - Read view/pure functions with type-smart input fields (address, uint, bool, bytes, string, arrays, tuples)
  - Write to state-changing functions with signing modal approval
  - Deploy new contract instances with constructor parameters and payable value support
  - Decoded event logs displayed inline after write transactions
  - Batch contract address setting per-network with proxy detection
  - Per-function loading states for concurrent interactions
  - Activity log tracking all contract reads, writes, and deploys
  - Truncated tx hashes with copy button and block explorer links
- **Wallet-proxied RPC** — when no `url` is configured for a network, JSON-RPC calls are automatically proxied through the connected browser wallet via Socket.io. No Alchemy/Infura API key needed.
- **Deploy from UI** — deploy contracts from the Contracts tab with constructor params, network selector, and payable value
- **Event viewer** — raw/formatted toggle for decoded event logs with auto-conversion of large numbers (wei/ether), hex to decimal, and timestamp detection
- **Block explorer utilities** — shared explorer URL mapping for Ethereum, Sepolia, Polygon, Arbitrum, Optimism, Base, BSC, Avalanche, Goerli, Mumbai, and more
- `npm run rebuild` convenience script in root package.json

### Changed

- Network config no longer requires `url` — AirSign falls back to wallet-proxied RPC when omitted
- `build:app` script now auto-cleans dist folder before building

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

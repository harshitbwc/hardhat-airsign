# hardhat-airsign

Deploy smart contracts from your dev machine. Sign transactions from anywhere — no private keys in `.env` files ever. Run Hardhat tasks and scripts directly from the browser.

## The Problem

Every Hardhat developer knows the drill: export your MetaMask private key, paste it into `.env`, and pray you never accidentally commit it. **hardhat-airsign** eliminates this entirely.

## How It Works

```
  Dev Machine (Terminal)                    Signer (Browser)
  ┌─────────────────────┐                  ┌──────────────────────┐
  │ npx hardhat run      │   HTTP / WS     │  localhost:9090      │
  │ scripts/deploy.js    │◄──────────────► │   ( ngrok URL )      │
  │ --network sepolia    │                 │                      │
  │                      │  1. unsigned tx  │  ┌────────────────┐  │
  │  getSigners() ──────────────────────►  │  │ Connect Wallet │  │
  │                      │                 │  └────────────────┘  │
  │                      │  2. signed tx   │                      │
  │  broadcasts tx ◄────────────────────── │  MetaMask signs      │
  └─────────────────────┘                  └──────────────────────┘
```

1. Run `npx hardhat airsign-start` — a signing server starts in the background on port `9090`
2. Open the URL in a browser and connect your wallet (MetaMask, Rainbow, Coinbase, etc.)
3. Run your deploy script — transactions appear in the browser for approval
4. Click **Confirm**, MetaMask signs, and the tx is broadcast. Done.

Your existing deploy scripts work without any changes.

## Features

- **Remote signing** — sign transactions from any machine, no private keys on the dev box
- **Runner UI** — run Hardhat tasks and scripts directly from the browser with a 3-column interface (list, detail, console)
- **Signing modal** — transaction approvals appear as an overlay without interrupting your workflow
- **Multi-wallet support** — MetaMask, Rainbow, Coinbase Wallet, WalletConnect via RainbowKit
- **Multi-chain** — Ethereum, Sepolia, Polygon, Arbitrum, Optimism, Base, BSC, Avalanche, and more
- **Zero config** — existing deploy scripts work as-is, just set `remoteSigner: true`
- **Block explorer links** — click through to Etherscan/Polygonscan after signing
- **Transaction history** — see all signed/rejected transactions in the current session

## Compatibility

| Dependency | Supported Version |
|------------|-------------------|
| Hardhat | v2.x (`^2.0.0`) |
| ethers.js | v5.x (`^5.0.0`) |
| Node.js | >= 18 |

> **Note:** This plugin uses `@nomiclabs/hardhat-ethers` (ethers v5). Projects using `@nomicfoundation/hardhat-ethers` with ethers v6 or Hardhat v3 are not yet supported. Hardhat 3 + ethers v6 support is on the roadmap.

## Quick Start

### 1. Install

```bash
npm install hardhat-airsign
```

### 2. Configure

```js
// hardhat.config.js
require("@nomiclabs/hardhat-ethers");
require("hardhat-airsign");

module.exports = {
  solidity: "0.8.24",
  networks: {
    sepolia: {
      url: "https://rpc.sepolia.org",
      remoteSigner: true,  // <-- that's it. no accounts/private keys needed.
    },
  },
};
```

### 3. Start the Signing Server

```bash
npx hardhat airsign-start
```

The server starts in the background and your terminal is free:

```
  ╔══════════════════════════════════════════════════╗
  ║            🔐 Hardhat AirSign v0.1.0             ║
  ╚══════════════════════════════════════════════════╝

  Signing UI:  http://localhost:9090
  Network:     http://192.168.1.100:9090

  1. Open the URL above in a browser
  2. Connect your MetaMask wallet
  3. Run deploy scripts in another terminal

  To check status:  npx hardhat airsign-status
  To stop server:   npx hardhat airsign-stop
```

### 4. Connect the Signer

Open the URL in a browser and connect your wallet via the RainbowKit UI.

For remote access (signer on a different machine):

```bash
ngrok http 9090
# Share the ngrok URL with the signer
```

### 5. Deploy

```bash
npx hardhat run scripts/deploy.js --network sepolia
```

The signer sees the transaction in their browser, clicks **Confirm**, and the contract deploys.

## Runner: Tasks & Scripts from the Browser

The **Runner** tab lets signers execute Hardhat tasks and scripts directly from the UI — no terminal needed on the signer's end.

### How it works

When the AirSign server starts, it extracts your project's tasks, scripts, and network configurations from the Hardhat Runtime Environment. The Runner UI presents these in a 3-column layout:

- **Left panel** — filterable list of all scripts and custom tasks
- **Middle panel** — selected item details with network selector, task parameter inputs, and environment variables
- **Right panel** — real-time console output streamed from the process

Signing requests triggered by a running script appear as a **modal overlay** on top of the Runner — no tab switching required. You approve or reject in-place and the script continues.

### Running a script

1. Switch to the **Runner** tab in the UI
2. Select a script from the left panel
3. Choose a target network
4. Click **Run**
5. Watch output stream in the console panel
6. Approve any signing requests in the modal overlay

### Running a task

Same flow, but tasks also show parameter inputs (text fields, flag toggles) extracted from the task definition.

## Usage in Scripts

The key design principle: **your existing scripts work as-is.** When `remoteSigner: true` is set, `hre.ethers.getSigners()` automatically returns the AirSign remote signer instead of a private-key signer.

```js
// This script works with BOTH AirSign and private keys.
// No code changes needed — just toggle the config.
async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with:", await deployer.getAddress());

  const Factory = await hre.ethers.getContractFactory("MyContract");
  const contract = await Factory.deploy();
  await contract.deployed();

  console.log("Deployed to:", contract.address);
}
```

Switching between AirSign and private keys is purely a config change:

```js
// AirSign — no private keys
sepolia: {
  url: "https://rpc.sepolia.org",
  remoteSigner: true,
}

// Private key — standard Hardhat
sepolia: {
  url: "https://rpc.sepolia.org",
  accounts: [process.env.PRIVATE_KEY],
}
```

### Advanced: Direct API

If you need explicit control (or aren't using `@nomiclabs/hardhat-ethers`):

```js
const signer = await hre.remoteSigner.getSigner();
```

## Commands

| Command | Description |
|---------|-------------|
| `npx hardhat airsign-start` | Start the signing server (background daemon) |
| `npx hardhat airsign-stop` | Stop the signing server |
| `npx hardhat airsign-status` | Check server and wallet status |

All commands accept `--port <number>` to use a custom port (default: `9090`).

## Configuration

```js
// hardhat.config.js
module.exports = {
  // Per-network: enable AirSign
  networks: {
    sepolia: {
      url: "https://rpc.sepolia.org",
      remoteSigner: true,
    },
  },

  // Global: customize AirSign settings (all optional)
  remoteSigner: {
    port: 9090,               // Server port (default: 9090)
    host: "0.0.0.0",          // Bind host (default: 0.0.0.0)
    sessionTimeout: 86400000,  // Session timeout in ms (default: 24h)
  },
};
```

## Architecture

The project is a monorepo with two packages:

- **`packages/plugin`** — The Hardhat plugin (published to npm as `hardhat-airsign`). Contains the `RemoteSigner` (custom ethers.js v5 Signer), `SigningServer` (Express + Socket.io), `SigningClient` (HTTP transport), Runner process execution, and CLI tasks.
- **`packages/app`** — The signing web app (private, embedded in the plugin). React + RainbowKit + wagmi + Tailwind with an iOS-inspired glass morphism design.

### How the pieces connect

1. `airsign-start` extracts tasks, networks, and scripts from the HRE, then launches a background daemon running `SigningServer`
2. The server serves the React app and exposes HTTP endpoints for deploy scripts and Runner process execution
3. Deploy scripts use `SigningClient` to communicate with the server via HTTP
4. The browser connects via Socket.io for real-time signing requests and console output streaming
5. When a deploy script calls `getSigners()`, the plugin connects to the server, gets the wallet address, and returns a `RemoteSigner`
6. `RemoteSigner.sendTransaction()` sends the unsigned tx to the server, which forwards it to the browser, where MetaMask signs and broadcasts it
7. The Runner spawns `npx hardhat run` or `npx hardhat <task>` as child processes, piping stdout/stderr to the browser in real time

## Limitations & Roadmap

- **Hardhat v2 + ethers v5 only** — requires `@nomiclabs/hardhat-ethers` with ethers v5. Hardhat 3 and `@nomicfoundation/hardhat-ethers` (ethers v6) support is planned.
- **Single signer** — `getSigners()` returns one signer (the connected wallet). Scripts that destructure multiple signers like `const [deployer, treasury] = await getSigners()` will only get one.
- **No `signTransaction()`** — browser wallets sign and broadcast in one step (`eth_sendTransaction`). The `signTransaction()` method throws. Use `sendTransaction()` instead, which is what 99% of scripts do.
- **One process at a time** — the Runner executes one script or task at a time. Wait for the current process to finish (or kill it) before starting another.

### Coming in v2

- Hardhat 3 + ethers v6 support
- Contract interaction UI (read/write functions from browser)
- Multi-signer support
- Deployment history & analytics

## Development

```bash
git clone https://github.com/harshitbwc/hardhat-airsign.git
cd hardhat-airsign

# Install all dependencies
npm install

# Build plugin + app
npm run build

# Dev mode (signing app with hot reload)
npm run dev:app

# Try the example project
cd example
npm install
npx hardhat airsign-start
npx hardhat run scripts/deploy.js --network sepolia
```

## Security

- Private keys **never** leave the signer's wallet (MetaMask, etc.)
- The dev machine only sees unsigned transactions and tx hashes
- All signing happens in the browser via the wallet's native UI
- The server restricts API access to same-origin requests only
- Request body validation and size limits (5MB) prevent abuse
- For remote access via ngrok, the connection is encrypted (HTTPS)
- Runner processes execute within the project directory with the same permissions as your terminal

## License

MIT

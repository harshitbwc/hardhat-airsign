require("dotenv").config();
require("@nomiclabs/hardhat-ethers");
require("hardhat-airsign");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.24",

  networks: {
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "https://rpc.sepolia.org",
      // Enable remote signing — no private keys needed!
      remoteSigner: true,
      // accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    // You can still use local networks normally
    localhost: {
      url: "http://127.0.0.1:8545",
    },
  },

  // Optional: customize AirSign settings
  // remoteSigner: {
  //   port: 9090, // default
  //   // sessionTimeout: 24 * 60 * 60 * 1000, // 24 hours
  // },
};

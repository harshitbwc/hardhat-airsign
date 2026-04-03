/**
 * Example deploy script — works with both AirSign and private keys.
 *
 * With AirSign (remoteSigner: true in config):
 *   1. npx hardhat airsign-start
 *   2. Open the URL and connect MetaMask
 *   3. npx hardhat run scripts/deploy.js --network sepolia
 *
 * With private key (accounts: [...] in config):
 *   npx hardhat run scripts/deploy.js --network sepolia
 *
 * The script is exactly the same either way — no code changes needed.
 */
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const address = await deployer.getAddress();
  console.log(`Deploying with account: ${address}`);

  const Greeter = await hre.ethers.getContractFactory("Greeter");

  console.log("Deploying Greeter contract...");
  console.log("(If using AirSign, check the browser to approve the transaction)\n");

  const greeter = await Greeter.deploy("Hello from Hardhat AirSign!");
  await greeter.deployed();

  console.log(`\nGreeter deployed to: ${greeter.address}`);
  console.log(`Transaction hash: ${greeter.deployTransaction.hash}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

/**
 * Example script to interact with a deployed contract.
 * Works with both AirSign and private keys — no code changes needed.
 *
 * Usage:
 *   GREETER_ADDRESS=0x... npx hardhat run scripts/interact.js --network sepolia
 */
const hre = require("hardhat");

async function main() {
  const CONTRACT_ADDRESS = process.env.GREETER_ADDRESS;

  if (!CONTRACT_ADDRESS) {
    console.error("Set GREETER_ADDRESS env variable to the deployed contract address");
    process.exit(1);
  }

  const [signer] = await hre.ethers.getSigners();
  const address = await signer.getAddress();
  console.log(`Using account: ${address}`);

  // Connect to the deployed contract
  const greeter = await hre.ethers.getContractAt("Greeter", CONTRACT_ADDRESS);

  // Read current greeting (no signing needed)
  const currentGreeting = await greeter.greet();
  console.log(`\nCurrent greeting: "${currentGreeting}"`);

  // Set a new greeting (requires signing)
  const newGreeting = "Hello from the remote signer!";
  console.log(`\nSetting new greeting: "${newGreeting}"`);
  console.log("(If using AirSign, check the browser to approve the transaction)\n");

  const tx = await greeter.setGreeting(newGreeting);
  console.log(`Transaction hash: ${tx.hash}`);
  console.log("Waiting for confirmation...");

  await tx.wait();
  console.log("Transaction confirmed!");

  // Verify the change
  const updatedGreeting = await greeter.greet();
  console.log(`\nUpdated greeting: "${updatedGreeting}"`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

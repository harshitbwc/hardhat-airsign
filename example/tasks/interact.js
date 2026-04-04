/**
 * Hardhat task to interact with a deployed Greeter contract.
 * Works with both AirSign and private keys — no code changes needed.
 *
 * Usage:
 *   npx hardhat interact --contract 0x... --network sepolia
 *   npx hardhat interact --contract 0x... --greeting "New greeting!" --network sepolia
 */
const { task } = require("hardhat/config");

task("interact", "Read and update the Greeter contract")
  .addParam("contract", "The deployed Greeter contract address")
  .addOptionalParam("greeting", "New greeting to set", "Hello from Hardhat task!")
  .setAction(async (taskArgs, hre) => {
    const { contract, greeting } = taskArgs;

    const [signer] = await hre.ethers.getSigners();
    const address = await signer.getAddress();
    console.log(`Using account: ${address}`);

    // Connect to the deployed contract
    const greeter = await hre.ethers.getContractAt("Greeter", contract);

    // Read current greeting (no signing needed)
    const currentGreeting = await greeter.greet();
    console.log(`\nCurrent greeting: "${currentGreeting}"`);

    // Set a new greeting (requires signing)
    console.log(`Setting new greeting: "${greeting}"`);
    console.log("(If using AirSign, check the browser to approve the transaction)\n");

    const tx = await greeter.setGreeting(greeting);
    console.log(`Transaction hash: ${tx.hash}`);
    console.log("Waiting for confirmation...");

    await tx.wait();
    console.log("Transaction confirmed!");

    // Verify the change
    const updatedGreeting = await greeter.greet();
    console.log(`\nUpdated greeting: "${updatedGreeting}"`);
  });

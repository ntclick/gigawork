import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

function main() {
    console.log("── Setup Wallets for Demo Agent ──\n");
    
    // Generate Agent Wallet
    const agentPK = generatePrivateKey();
    const agentAccount = privateKeyToAccount(agentPK);
    
    // Generate Client Wallet
    const clientPK = generatePrivateKey();
    const clientAccount = privateKeyToAccount(clientPK);

    console.log("Add the following lines to your .env file:\n");
    console.log(`AGENT_PRIVATE_KEY=${agentPK}`);
    console.log(`CLIENT_PRIVATE_KEY=${clientPK}`);
    console.log("\n");

    console.log("── Funding Required ──");
    console.log("Please fund both of the following addresses with ARC and USDC on the Arc Testnet:");
    console.log(`Agent Address: ${agentAccount.address}`);
    console.log(`Client Address: ${clientAccount.address}\n`);
    
    console.log("You can get testnet USDC and ARC from standard faucets or the dev console.");
    console.log("Once funded, you can run 'npm run register' then 'npm run job'.");
}

main();

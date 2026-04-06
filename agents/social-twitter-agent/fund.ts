import "dotenv/config";
import { createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

const clientAcc = privateKeyToAccount(process.env.PRIVATE_KEY as any);
const agentAcc = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as any);

const wallet = createWalletClient({ account: clientAcc, chain: arcTestnet, transport: http() });

async function fund() {
    console.log("Funding agent address: " + agentAcc.address);
    const hash = await wallet.sendTransaction({
        to: agentAcc.address,
        value: parseEther("0.05")
    });
    console.log("Tx: ", hash);
}

fund().catch(console.error);

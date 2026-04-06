import "dotenv/config";
import { createPublicClient, createWalletClient, http, parseAbiItem } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";

const metadataObj = {
  "name": "Social Media AI Agent",
  "description": "Autonomous AI agent that creates viral Web3 content for Twitter/X.",
  "image": "ipfs://QmDummySocialAgentImageHash",
  "agent_type": "copywriter",
  "capabilities": ["twitter", "copywriting", "llm"],
  "version": "1.0.0",
  "pricingModel": {
    "type": "per_use",
    "rate": 5000000 // 5.0 USDC
  }
};

const METADATA_URI = `data:application/json;base64,${Buffer.from(JSON.stringify(metadataObj)).toString("base64")}`;

const agentAccount = privateKeyToAccount((process.env.AGENT_PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000000") as `0x${string}`);

const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
const agentWalletClient = createWalletClient({ account: agentAccount, chain: arcTestnet, transport: http() });

const identityAbi = [
  { name: "register", type: "function", stateMutability: "nonpayable", inputs: [{ name: "metadataURI", type: "string" }], outputs: [] }
] as const;

async function waitForReceipt(hash: `0x${string}`, label: string) {
  console.log(`  Waiting for ${label}: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`  ${label} confirmed in block ${receipt.blockNumber}`);
  return receipt;
}

async function main() {
  if (process.env.AGENT_PRIVATE_KEY === undefined || process.env.AGENT_PRIVATE_KEY.length < 60) {
    console.warn("WARNING: Invalid or missing AGENT_PRIVATE_KEY in .env");
    return;
  }

  console.log("\n── Step 1: Prepare Wallet ──");
  console.log(`  Agent Owner: ${agentAccount.address}`);

  console.log("\n── Step 2: Register Agent Identity On-Chain (ERC-8004) ──");
  const registerTx = await agentWalletClient.writeContract({
    address: IDENTITY_REGISTRY,
    abi: identityAbi,
    functionName: "register",
    args: [METADATA_URI],
    account: agentAccount
  });
  const receipt = await waitForReceipt(registerTx, "Registration");

  console.log("\n── Step 3: Retrieve Agent ID ──");
  const transferLogs = await publicClient.getLogs({
    address: IDENTITY_REGISTRY,
    event: parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"),
    args: { to: agentAccount.address },
    fromBlock: receipt.blockNumber,
    toBlock: receipt.blockNumber,
  });

  if (transferLogs.length === 0) throw new Error("Registration failed to emit Transfer event");
  const agentId = transferLogs[transferLogs.length - 1].args.tokenId;
  
  console.log(`  Successfully minted Agent ID: ${agentId}`);

  console.log("\n── Step 4: Register Agent on GigaWork Platform ──");
  try {
    const res = await fetch("http://localhost:8181/api/agents/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: agentAccount.address,
        erc8004_token_id: Number(agentId),
        hourly_rate_usdc: 0.1,
        billing_unit: "task",
        skill_tags: ["twitter", "copywriting", "llm"],
        name: "Social Media AI Agent",
        description: "Tạo nội dung viral cho Twitter/X về Web3, Crypto, DeFi. Nhập chủ đề → nhận bài đăng hoàn chỉnh kèm hashtag.",
        agent_type: "copywriter"
      })
    });
    
    if (res.ok) {
      console.log(`  ✅ Agent successfully registered on GigaWork Marketplace!`);
      console.log(`  View at: http://localhost:8181/app/agents`);
    } else {
      const errText = await res.text();
      console.log(`  ❌ Platform registration failed (but on-chain minted): ${errText}`);
    }
  } catch (err) {
    console.log(`  ❌ Could not connect to GigaWork backend. Make sure the server is running on port 8181.`);
  }
}

main().catch(console.error);

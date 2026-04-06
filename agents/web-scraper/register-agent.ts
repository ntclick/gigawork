import "dotenv/config";
import { createPublicClient, createWalletClient, getContract, http, keccak256, parseAbiItem, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const REPUTATION_REGISTRY = "0x8004B663056A597Dffe9eCcC1965A193B7388713";

// We simulate metadata upload by just encoding it as a Data URI or using a mock IPFS url
const metadataObj = {
  "name": "Advanced Data Extractor Agent",
  "description": "Autonomous scraping AI agent to extract deep webpage contents.",
  "image": "ipfs://QmDummyScraperImageHash",
  "agent_type": "data_aggregator",
  "capabilities": ["web_scraping", "data_extraction"],
  "version": "1.0.0",
  "pricingModel": {
    "type": "per_use",
    "rate": 1000000 // 1 USDC per scrape
  }
};

const METADATA_URI = `data:application/json;base64,${Buffer.from(JSON.stringify(metadataObj)).toString("base64")}`;

const agentAccount = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as \`0x\${string}\`);

const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
const agentWalletClient = createWalletClient({ account: agentAccount, chain: arcTestnet, transport: http() });

const identityAbi = [
  { name: "register", type: "function", stateMutability: "nonpayable", inputs: [{ name: "metadataURI", type: "string" }], outputs: [] },
  { name: "ownerOf", type: "function", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "address" }] },
  { name: "tokenURI", type: "function", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "string" }] }
] as const;

async function waitForReceipt(hash: \`0x\${string}\`, label: string) {
  console.log(\`  Waiting for \${label}: \${hash}\`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(\`  \${label} confirmed in block \${receipt.blockNumber}\`);
  return receipt;
}

async function main() {
  console.log("\\n── Step 1: Prepare Wallet ──");
  console.log(\`  Agent Owner: \${agentAccount.address}\`);

  console.log("\\n── Step 2: Register Agent Identity (ERC-8004) ──");
  const registerTx = await agentWalletClient.writeContract({
    address: IDENTITY_REGISTRY,
    abi: identityAbi,
    functionName: "register",
    args: [METADATA_URI],
    account: agentAccount
  });
  const receipt = await waitForReceipt(registerTx, "Registration");

  console.log("\\n── Step 3: Retrieve Agent ID ──");
  const transferLogs = await publicClient.getLogs({
    address: IDENTITY_REGISTRY,
    event: parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"),
    args: { to: agentAccount.address },
    fromBlock: receipt.blockNumber,
    toBlock: receipt.blockNumber,
  });

  if (transferLogs.length === 0) throw new Error("Registration failed to emit Transfer event");
  const agentId = transferLogs[transferLogs.length - 1].args.tokenId;
  
  console.log(\`  Successfully registered Agent ID: \${agentId}\`);
  console.log(\`  View on Explorer: https://testnet.arcscan.app/address/\${agentAccount.address}\`);
  console.log("\\n  You can now use this Agent ID to receive jobs!");
}

main().catch(console.error);

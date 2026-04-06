import "dotenv/config";
import { createPublicClient, createWalletClient, http, keccak256, parseUnits, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import OpenAI from "openai";
import { arcTestnet } from "viem/chains";
import * as fs from "fs";

const AGENTIC_COMMERCE_CONTRACT = "0xefe28b2fb1146a5d95c7e5e134cef7a180d47e34";
const USDC_CONTRACT = "0x3600000000000000000000000000000000000000";

// For Demo, 5 USDC per tweet.
const JOB_BUDGET = parseUnits("5", 6); // USDC uses 6 decimals

const topic = process.argv[2] || "The future of AI and blockchain convergence";

const clientAccount = privateKeyToAccount((process.env.CLIENT_PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000000") as `0x${string}`);
const agentAccount = privateKeyToAccount((process.env.AGENT_PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000000") as `0x${string}`);

const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
const clientWallet = createWalletClient({ account: clientAccount, chain: arcTestnet, transport: http() });
const agentWallet = createWalletClient({ account: agentAccount, chain: arcTestnet, transport: http() });

const agenticCommerceAbi = [
  { name: "createJob", type: "function", stateMutability: "nonpayable", inputs: [{ name: "provider", type: "address" }, { name: "evaluator", type: "address" }, { name: "expiredAt", type: "uint256" }, { name: "description", type: "string" }, { name: "optParams", type: "bytes" }], outputs: [{ name: "jobId", type: "uint256" }] },
  { name: "setBudget", type: "function", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "amount", type: "uint256" }, { name: "optParams", type: "bytes" }], outputs: [] },
  { name: "fund", type: "function", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "expectedBudget", type: "uint256" }, { name: "optParams", type: "bytes" }], outputs: [] },
  { name: "submit", type: "function", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "deliverable", type: "bytes32" }, { name: "optParams", type: "bytes" }], outputs: [] },
  { name: "complete", type: "function", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "reason", type: "bytes32" }, { name: "optParams", type: "bytes" }], outputs: [] },
] as const;

const erc20Abi = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] }
] as const;

async function waitForReceipt(hash: `0x${string}`, label: string) {
  process.stdout.write(`\n[${label}] Waiting for confirmation...`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(` => Confirmed in Block ${receipt.blockNumber}`);
  return receipt;
}

async function main() {
  console.log(`\nClient Address: ${clientAccount.address}`);
  console.log(`Agent Address: ${agentAccount.address}`);

  console.log("\n== GigaWork Agent Workflow (Copywriter AI) ==");
  console.log(`Target Topic: "${topic}"\n`);
  
  const block = await publicClient.getBlock();
  const expiredAt = block.timestamp + 3600n; // 1 hour

  console.log("[Client] Transferring Native Gas to Agent (Starter Fund)...");
  try {
    const transferGasHash = await clientWallet.sendTransaction({
      to: agentAccount.address,
      value: parseUnits("2", 18)
    });
    await waitForReceipt(transferGasHash, "transfer starter gas");
  } catch(e) {
    console.log("-> Skipped transfer (maybe insufficient balance or already funded)");
  }

  console.log("\n[Client] Creating On-chain Job for Tweet writing task...");
  const createJobHash = await clientWallet.writeContract({
    address: AGENTIC_COMMERCE_CONTRACT,
    abi: agenticCommerceAbi,
    functionName: "createJob",
    args: [agentAccount.address, clientAccount.address, expiredAt, `Write an engaging tweet about: ${topic}`, "0x"]
  });
  const receipt = await waitForReceipt(createJobHash, "createJob");
  
  const jobCreatedEventSig = keccak256(toHex("JobCreated(uint256,address,address,address)"));
  let jobId: bigint | undefined;
  for (const log of receipt.logs) {
     if (log.topics[0] === jobCreatedEventSig) {
        jobId = BigInt(log.topics[1]!);
     }
  }

  if (jobId == null) throw new Error("Could not extract JobId");
  console.log(`[Client] Job ID ${jobId} Created.`);

  console.log(`\n[Agent] Acknowledging Job & Setting Budget (${JOB_BUDGET} USDC) ...`);
  const setBudgetHash = await agentWallet.writeContract({
    address: AGENTIC_COMMERCE_CONTRACT,
    abi: agenticCommerceAbi,
    functionName: "setBudget",
    args: [jobId, JOB_BUDGET, "0x"]
  });
  await waitForReceipt(setBudgetHash, "setBudget");

  console.log("\n[Client] Approving USDC & Funding Escrow...");
  const approveHash = await clientWallet.writeContract({
    address: USDC_CONTRACT,
    abi: erc20Abi,
    functionName: "approve",
    args: [AGENTIC_COMMERCE_CONTRACT, JOB_BUDGET]
  });
  await waitForReceipt(approveHash, "approve");

  const fundHash = await clientWallet.writeContract({
    address: AGENTIC_COMMERCE_CONTRACT,
    abi: agenticCommerceAbi,
    functionName: "fund",
    args: [jobId, JOB_BUDGET, "0x"]
  });
  await waitForReceipt(fundHash, "fund");

  console.log(`\n[Agent] Thinking... Generating tweet using OpenAI (DeepSeek)...`);
  const openai = new OpenAI({ 
    baseURL: "https://api.deepseek.com",
    apiKey: process.env.DEEPSEEK_API_KEY 
  });

  let tweetContent = "";
  try {
    const prompt = `You are a viral social media manager for Web3 and AI topics. Write a single short, engaging tweet about: "${topic}". Use emojis. No quotes around the tweet. Focus on getting engagement.`;
    const response = await openai.chat.completions.create({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }], // Need actual Deepseek API Key
    });
    tweetContent = response.choices[0].message.content || "";
  } catch (e) {
    console.log("[Agent AI Notice] AI failed (likely missing API Key), using fallback copy...");
    tweetContent = `🚀 Just explored: ${topic}! The convergence of AI and blockchain is unlocking massive potential on the @ArcNetwork_! What are your thoughts? 👇 #Web3 #AI #ArcNetwork`;
  }

  console.log(`\n========================================`);
  console.log(`[RESULT TWEET]: ${tweetContent}`);
  console.log(`========================================\n`);
  
  const resultData = { tweet: tweetContent, generatedAt: new Date().toISOString() };
  fs.writeFileSync("output_tweet.json", JSON.stringify(resultData, null, 2));
  
  // Hash the output to use as deliverable
  const deliverableHash = keccak256(toHex(JSON.stringify(resultData)));
  
  console.log(`[Agent] Submitting Deliverable Hash to Arc Network: ${deliverableHash}`);
  const submitHash = await agentWallet.writeContract({
    address: AGENTIC_COMMERCE_CONTRACT,
    abi: agenticCommerceAbi,
    functionName: "submit",
    args: [jobId, deliverableHash, "0x"]
  });
  await waitForReceipt(submitHash, "submit");

  console.log("\n[Client] Looking great! Evaluating results & Completing Task...");
  const completeHash = await clientWallet.writeContract({
    address: AGENTIC_COMMERCE_CONTRACT,
    abi: agenticCommerceAbi,
    functionName: "complete",
    args: [jobId, keccak256(toHex("approved")), "0x"]
  });
  await waitForReceipt(completeHash, "complete");

  console.log("\n== Copywriter Agent Demo Completed Successfully! ==");
  console.log(`Explorer: https://testnet.arcscan.app/tx/${completeHash}`);
}

main().catch(console.error);

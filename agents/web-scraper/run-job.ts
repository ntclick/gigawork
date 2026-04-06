import "dotenv/config";
import { createPublicClient, createWalletClient, decodeEventLog, http, keccak256, parseUnits, toHex, parseAbiItem } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import OpenAI from "openai";
import { arcTestnet } from "viem/chains";
import { ApifyClient } from "apify-client";
import * as fs from "fs";

const AGENTIC_COMMERCE_CONTRACT = "0xefe28B2FB1146A5d95c7E5e134cEF7a180D47e34";
const USDC_CONTRACT = "0x3600000000000000000000000000000000000000";

// For Demo, 1 USDC per scrape.
const JOB_BUDGET = parseUnits("1", 6);

const targetUrl = process.argv[2] || "https://arc.network";

const clientAccount = privateKeyToAccount(process.env.CLIENT_PRIVATE_KEY as `0x${string}`);
const agentAccount = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as `0x${string}`);

const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
const clientWallet = createWalletClient({ account: clientAccount, chain: arcTestnet, transport: http() });
const agentWallet = createWalletClient({ account: agentAccount, chain: arcTestnet, transport: http() });

const apifyClient = new ApifyClient({ token: process.env.APIFY_API_TOKEN });

const agenticCommerceAbi = [
  { name: "createJob", type: "function", stateMutability: "nonpayable", inputs: [{ name: "provider", type: "address" }, { name: "evaluator", type: "address" }, { name: "expiredAt", type: "uint256" }, { name: "description", type: "string" }, { name: "optParams", type: "bytes" }], outputs: [{ name: "jobId", type: "uint256" }] },
  { name: "setBudget", type: "function", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "amount", type: "uint256" }, { name: "optParams", type: "bytes" }], outputs: [] },
  { name: "fund", type: "function", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "expectedBudget", type: "uint256" }, { name: "optParams", type: "bytes" }], outputs: [] },
  { name: "submit", type: "function", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "deliverable", type: "bytes32" }, { name: "optParams", type: "bytes" }], outputs: [] },
  { name: "complete", type: "function", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "reason", type: "bytes32" }, { name: "optParams", type: "bytes" }], outputs: [] },
  { name: "getJob", type: "function", stateMutability: "view", inputs: [{ name: "jobId", type: "uint256" }], outputs: [{ type: "tuple", components: [{ name: "id", type: "uint256" }, { name: "status", type: "uint8" }] }] }
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

async function scrapeWithApify(url: string) {
  console.log(`\n[Agent] Starting off-chain task: Extracting data from ${url}...`);
  
  // We use the basic Cheerio Scraper from Apify
  const run = await apifyClient.actor("apify/cheerio-scraper").call({
    startUrls: [{ url }],
    pageFunction: "async function pageFunction(context) { const { $, request } = context; return { url: request.url, title: $('title').text() }; }",
    maxRequestsPerCrawl: 1,
  });

  console.log(`[Agent] Extraction completed. Dataset ID: ${run.defaultDatasetId}`);
  
  const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
  const summary = {
    scrapedUrl: url,
    title: items[0]?.pageTitle || items[0]?.title || "No Title",
    contentLength: JSON.stringify(items[0]).length,
    timestamp: new Date().toISOString()
  };

  fs.writeFileSync("last_scrape.json", JSON.stringify(summary, null, 2));
  console.log(`[Agent] Results saved to last_scrape.json`);
  
  return summary;
}

async function main() {
  console.log("== GigaWork Agent Workflow (Client <-> Extractor AI) ==");
  
  const block = await publicClient.getBlock();
  const expiredAt = block.timestamp + 3600n;

  console.log("\n[Client] Transferring Native Gas to Agent (Starter Fund)...");
  // Chuyển 0.05 Native Token cho Agent để làm phí Gas (tránh phải faucet 2 lần)
  const transferGasHash = await clientWallet.sendTransaction({
    to: agentAccount.address,
    value: parseUnits("0.05", 18)
  });
  await waitForReceipt(transferGasHash, "transfer starter gas");

  console.log("\n[Client] Creating Job for Data Extraction task...");
  const createJobHash = await clientWallet.writeContract({
    address: AGENTIC_COMMERCE_CONTRACT,
    abi: agenticCommerceAbi,
    functionName: "createJob",
    args: [agentAccount.address, clientAccount.address, expiredAt, `Extract ${targetUrl}`, "0x"]
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

  console.log(`\n[Agent] Acknowledging Job & Setting Budget (${JOB_BUDGET} USDC) based on 'per_use' pricing...`);
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

const openai = new OpenAI({ 
  baseURL: "https://api.deepseek.com",
  apiKey: process.env.DEEPSEEK_API_KEY 
});

async function summarizeWithAI(rawData: any) {
  console.log(`\n[Agent] Summarizing data with Deepseek AI...`);
  const prompt = `You are a data extractor agent. Summarize the following raw website extraction into a highly structured JSON blob. Return ONLY the JSON object, no markdown wrappers, no explanations:\n${JSON.stringify(rawData).substring(0, 5000)}`;

  try {
    const response = await openai.chat.completions.create({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
    });
    let text = response.choices[0].message.content || "{}";
    if (text.startsWith("```json")) { text = text.slice(7, -3); }
    else if (text.startsWith("```")) { text = text.slice(3, -3); }
    return JSON.parse(text);
  } catch (e) {
    console.error("[Agent AI Error]", e);
    return { error: "AI failed to parse", raw: rawData };
  }
}

  // ------------------------------------------
  // OFF CHAIN TASK
  // ------------------------------------------
  const scrapedRaw = await scrapeWithApify(targetUrl);
  const resultData = await summarizeWithAI(scrapedRaw);
  
  // Hash the output to use as deliverable
  const deliverableHash = keccak256(toHex(JSON.stringify(resultData)));
  
  console.log(`\n[Agent] Submitting Deliverable Hash to Arc Network: ${deliverableHash}`);
  const submitHash = await agentWallet.writeContract({
    address: AGENTIC_COMMERCE_CONTRACT,
    abi: agenticCommerceAbi,
    functionName: "submit",
    args: [jobId, deliverableHash, "0x"]
  });
  await waitForReceipt(submitHash, "submit");

  console.log(`\n[Agent] Delivery complete. Pushing payload back to GigaWork platform...`);
  try {
    const res = await fetch(`http://localhost:8181/api/jobs/${jobId}/submit-result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        result_hash: deliverableHash,
        proof_uri: "API_DELIVERY",
        result_data: resultData
      })
    });
    console.log(`[Agent] GigaWork backend response: ${res.status}`);
  } catch(e) {
    console.log(`[Agent] Note: Could not push to local platform backend.`);
  }

  console.log("\n[Client] Evaluating results & Completing Task...");
  const completeHash = await clientWallet.writeContract({
    address: AGENTIC_COMMERCE_CONTRACT,
    abi: agenticCommerceAbi,
    functionName: "complete",
    args: [jobId, keccak256(toHex("approved")), "0x"]
  });
  await waitForReceipt(completeHash, "complete");

  console.log("\n== Demo Completed Successfully! ==");
  console.log(`Explorer: https://testnet.arcscan.app/tx/${completeHash}`);
}

main().catch(console.error);

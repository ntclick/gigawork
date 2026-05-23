# 🛰️ GigaWork v2 & Cosmic Name Raffle

AI agent orchestration platform with on-chain settlement on Arc Testnet, featuring a decentralized, provably-fair **Cosmic Name Raffle** campaign drawing engine.

---

## 🏗️ Part 1: GigaWork v2 Core

GigaWork v2 is an AI agent orchestration platform where users submit a prompt → Hermes AI plans and dispatches skill agents → results settle via ERC-8183 escrow → reputation is recorded via ERC-8004.

### How it works

1. **User creates a workflow** — prompt goes in, identity NFT (ERC-8004) required.
2. **Escrow funded** — user signs 3 txs (createJob → approve USDC → fund); USDC locks in ERC-8183 contract.
3. **Hermes orchestrates** — AI brain plans a DAG of skill agents, dispatches them in parallel, and composes the final report.
4. **On-chain settlement** — platform submits deliverable hash + completes job; USDC released.
5. **Reputation recorded** — ERC-8004 `giveFeedback` for every agent that participated.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full picture.

### GigaWork Core Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 16 App Router, TypeScript strict, Tailwind CSS v4 |
| AI | Vercel AI SDK 6, `@ai-sdk/openai-compatible` — default: OpenAI `gpt-4.1` |
| Auth + Wallet | Privy (embedded + external), viem |
| Chain | Arc Testnet (Chain ID 5042002, native gas = USDC) |
| DB | Supabase Postgres + Drizzle ORM |
| Canvas | `@xyflow/react` |

---

## 🌌 Part 2: Cosmic Name Raffle Dashboard

The **Cosmic Name Raffle** is the flagship provably-fair drawing engine built into the GigaWork v2 platform. It integrates physical space entropy via the **SpaceComputer Cosmic True Random Number Generator (cTRNG)** and secure smart contracts on the Arc Network.

### cTRNG & Dual-Entropy Randomness Model
- **Space Radiation Entropy:** Sourced from **SpaceComputer cTRNG**, leveraging satellite radiation detectors in low Earth orbit to gather physical, non-deterministic entropy.
- **Terrestrial Block Hash:** The raffle assigns a unique future target block number on the Arc Network. The drawing cannot proceed until this block is mined.
- **The Mix:** Once the target block is mined, the seed is derived on-chain using:
  $$\text{Cosmic Seed} = \text{Keccak256}(\text{Block Hash} + \text{Space Radiation Entropy})$$
This ensures that neither network miners nor space satellite operators can manipulate or front-run the drawing alone.

### Cryptographic Merkle Integrity & Verification
- **Merkle Tree:** Contestant lists are parsed, sorted lexicographically, and compiled into a local Merkle Tree.
- **Baseline Root:** The cryptographic **Merkle Root** is submitted and stored permanently on-chain when the campaign is created. No entries can be added, deleted, or substituted after creation.
- **On-chain Proof Validation:** Winning index entries are cross-referenced with their Merkle sibling paths directly in the smart contract during the draw phase, storing absolute proof of fair play forever.
- **Complete Decentralization (Host-Signed):** Contract execution permissions are strictly delegated to the campaign host (`require(msg.sender == host)`). Drawing is initiated directly on the frontend, prompting the host to sign and broadcast the `drawWinners` transaction via standard Web3 wallets (Metamask, OKX, Privy), removing centralized backend operators.

---

## 🛠️ Smart Contract Addresses (Arc Testnet)

| Contract | Address / Link |
|----------|---------|
| ERC-8183 AgenticCommerce | `0x0747EEf0706327138c69792bF28Cd525089e4583` |
| ERC-8004 ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| ERC-8004 ValidationRegistry | `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` |
| CosmicRaffle | `0x3ea7ed77795acad23e414daea25af690810d6dbb` ([ArcScan Verified Code](https://testnet.arcscan.app/address/0x3ea7ed77795acad23e414daea25af690810d6dbb#code)) |
| USDC | `0x3600000000000000000000000000000000000000` |

---

## 🛸 UI Visual Telemetry Features
- **CRT Terminal Console:** A high-impact digital cyber scanner that autoscrolls participant entries at a fast 40ms interval with scanline overlays during drawing, outputting live blockchain interaction logs corresponding to block mining confirmations, cTRNG IPFS beacon fetching, and EVM contract transacting.
- **Blockchain Telemetry Progress Bar:** Counts down block progression with glowing gauges, percentages, and block remaining estimates.
- **Offline Provably-Fair Console:** Allows participants to copy their Merkle proof sibling path and verify their win status 100% offline in a monospace retro validation terminal running entirely in the local browser.

---

## 🏃 Setup & Dev

### 1. Environment

Copy environment template:
```bash
cp .env.example .env.local
```

Make sure the following variables are defined in your `.env` or `.env.local`:
```env
# Database
DATABASE_URL=postgresql://...

# AI brain
OPENAI_API_KEY=sk-...

# Privy auth
NEXT_PUBLIC_PRIVY_APP_ID=...
NEXT_PUBLIC_PRIVY_CLIENT_ID=...

# Arc Testnet RPC
ARC_RPC_URL=https://rpc.testnet.arc.network
NEXT_PUBLIC_ARC_RPC=https://rpc.testnet.arc.network
NEXT_PUBLIC_ARC_EXPLORER=https://testnet.arcscan.app

# Smart Contracts
IDENTITY_REGISTRY_ADDRESS=0x8004A818BFB912233c491871b3d84c89A494BD9e
NEXT_PUBLIC_COSMIC_RAFFLE_ADDRESS=0x3ea7ed77795acad23e414daea25af690810d6dbb
ADMIN_PRIVATE_KEY=0x...
```

### 2. Database Setup
```bash
pnpm db:generate
pnpm db:push
```

### 3. Seed Skills + Mint Agent NFTs
```bash
# Seed skills into Database
pnpm db:seed

# Mint ERC-8004 identity NFTs
pnpm tsx scripts/mint-agents.ts
```

### 4. Dev Server
```bash
pnpm dev
# App starts at http://localhost:3000
```

---

## 📦 Project Scripts & Commands

| Command | Description |
| :--- | :--- |
| `pnpm dev` | Run the Next.js local development server (with Turbopack). |
| `pnpm raffle:compile` | Compile `CosmicRaffle.sol` using local solc bindings and output ABI/Bytecode. |
| `pnpm raffle:deploy` | Deploy the compiled contract to the Arc Testnet using the administrator private key. |
| `pnpm raffle:verify` | Automatically submit source code and constructor parameters to verify the contract on ArcScan. |
| `pnpm raffle:test` | Run the comprehensive E2E regression test checking Merkle Trees, block targets, and cTRNG mixing. |

---

## 🧪 Cosmic Name Raffle E2E Integration Test

To run the complete on-chain test suite verifying the compilation, deployment, space entropy IPFS fetching, block target alignment, and final Merkle proof validation:
```bash
pnpm raffle:test
```

### Expected Output
```text
🏁 Starting End-to-End Cosmic Raffle Integration Test...

🏡 Contract Address: 0x3ea7ed77795acad23e414daea25af690810d6dbb
👤 Parsed unique contestants: [ 'Alice', 'Bob', 'Charlie', 'Dave', 'Eve' ]
🌳 Merkle Root computed: 0xd55bd9f9334753d1d179feb066b9b91527e54af99a1aab0b51087732689628e1
📡 Creating raffle on-chain...
   - Title: E2E Test Raffle
   - Total Entries: 5
   - Winner Count: 2
   - Commit Block: 43618810
✅ Raffle transaction confirmed in block 43618812!
⏳ Waiting for block 43618810 to be mined...
✅ Target block 43618810 reached!
🛰️ Fetching Cosmic Seed from SpaceComputer cTRNG setup...
✓ Blockchain block hash resolved: 0xa95a1d41b4892a3f4c13a36f04398428d49f98c4951a3a552759786fa145a230
🌌 Successfully retrieved SpaceComputer cTRNG cosmic entropy: 234a3f1583bea5b83ad86122b9ca71adaccbb2cd20cfef5c977b277a0f10052d
🔮 Mixed dual-entropy cosmic seed derived: 0x0b5ef4223d28afaf5c8ad40ea3151c5677cd5a7f59c716a373d528288352956a
📡 Sending drawWinners transaction to blockchain...
✅ On-chain draw successfully confirmed in block 43618823!
🏆 Winning indices drawn by contract: [ 1, 0 ]

🎉 --- VERIFIABLE DRAW RESULTS ---
Winner #1: "Bob" (Ticket Index #1)
  - Cryptographic Proof Valid: ✅ YES
Winner #2: "Alice" (Ticket Index #0)
  - Cryptographic Proof Valid: ✅ YES
------------------------------------

🏁 End-to-End Cosmic Raffle Integration Test completed successfully!
```

# GigaWork v2

AI agent orchestration platform with on-chain settlement on Arc Testnet. User submits a prompt → Hermes AI plans and dispatches skill agents → results settle via ERC-8183 escrow → reputation recorded via ERC-8004.

## How it works

1. **User creates a workflow** — prompt goes in, identity NFT (ERC-8004) required
2. **Escrow funded** — user signs 3 txs (createJob → approve USDC → fund); USDC locks in ERC-8183 contract
3. **Hermes orchestrates** — AI brain plans a DAG of skill agents, dispatches them in parallel, composes final report
4. **On-chain settlement** — platform submits deliverable hash + completes job; USDC released
5. **Reputation recorded** — ERC-8004 `giveFeedback` for every agent that participated

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full picture.

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 15 App Router, TypeScript strict, Tailwind CSS v4 |
| AI | Vercel AI SDK 6, `@ai-sdk/openai-compatible` — default: OpenAI `gpt-4.1` |
| Auth + Wallet | Privy (embedded + external), viem |
| Chain | Arc Testnet (Chain ID 5042002, native gas = USDC) |
| DB | Supabase Postgres + Drizzle ORM |
| Canvas | `@xyflow/react` |

## Setup

### 1. Environment

```bash
cp .env.example .env.local
```

**Required:**

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

# ERC-8004 Identity
IDENTITY_REGISTRY_ADDRESS=0x...
ADMIN_PRIVATE_KEY=0x...
```

**ERC-8183 escrow (nếu bật):**

```env
ERC8183_ENABLED=1
ERC8183_USER_CLIENT=1          # 1 = user ký 3 tx (Privy flow)
ERC8183_BUDGET_USDC=0.05
AGENTIC_COMMERCE_ADDRESS=0x0747EEf0706327138c69792bF28Cd525089e4583
NEXT_PUBLIC_USDC_ADDRESS=0x3600000000000000000000000000000000000000
```

**ERC-8004 Reputation (tùy chọn):**

```env
REPUTATION_REGISTRY_ADDRESS=0x8004B663056A597Dffe9eCcC1965A193B7388713
VALIDATION_REGISTRY_ADDRESS=0x8004Cb1BF31DAf7788923b405b754f57acEB4272
```

**AI provider khác (tùy chọn):**

```env
# Kimi K2
AI_PROVIDER=kimi
KIMI_API_KEY=...

# DeepSeek
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=...
```

### 2. Database

```bash
pnpm db:generate
pnpm db:push
```

### 3. Seed skills + mint agent NFTs

```bash
# Seed skill records vào DB
pnpm tsx scripts/seed-skills.ts

# Mint ERC-8004 identity NFT cho mỗi skill (cần ADMIN_PRIVATE_KEY)
pnpm tsx scripts/mint-agents.ts
```

### 4. Dev

```bash
pnpm dev
# http://localhost:3000
```

## Smart Contracts (Arc Testnet)

| Contract | Address |
|----------|---------|
| ERC-8183 AgenticCommerce | `0x0747EEf0706327138c69792bF28Cd525089e4583` |
| ERC-8004 ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| ERC-8004 ValidationRegistry | `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` |
| USDC | `0x3600000000000000000000000000000000000000` |

## Project structure

```
app/
  (chat)/
    page.tsx                        # Home — prompt input
    workflow/[id]/page.tsx          # Workflow page (escrow + canvas + doc panel)
  api/
    workflow/route.ts               # POST: create workflow
    workflow/[id]/stream/route.ts   # POST: Hermes brain stream (SSE)
    workflow/[id]/messages/route.ts # GET: workflow snapshot
    workflow/[id]/reputation/       # POST: reputation reconcile
    workflow/[id]/validation/       # validation prepare/reconcile/respond
    workflow/escrow/                # prepare / post-create / confirm / bypass
    identity/                       # mint / prepare / confirm
    auth/                           # login / logout

components/
  chat/
    WorkflowCanvas.tsx              # ReactFlow canvas with trail UI
    WorkflowDocPanel.tsx            # ERC-8183 trail + reputation panel
    NodeDetailSheet.tsx
  shell/
    AppRail.tsx
    MainHeader.tsx

lib/
  ai/
    brain.ts                        # streamBrain() — OpenAI/Kimi/DeepSeek
    tools.ts                        # planWorkflow, dispatchSkill, finalizeReport
    prompts.ts                      # HERMES_SYSTEM_PROMPT
    finalizeWorkflow.ts             # settlement + reputation pipeline
  chain/
    agenticCommerce.ts              # ERC-8183 lifecycle
    identity.ts                     # ERC-8004 identity NFT
    reputation.ts                   # ERC-8004 giveFeedback
    validation.ts                   # ERC-8004 validationRequest/Response
    client.ts                       # viem clients + admin wallet
    arcTestnet.ts                   # Arc chain definition (USDC gas)
  db/
    schema.ts                       # workflows, nodes, messages, skills, users
    client.ts
  hooks/
    useEscrowPost.ts                # Escrow state machine (3-step wallet flow)
    useActiveWallet.ts
    useValidationAttest.ts
  credits/
    service.ts                      # chargeCredits, grantSignupBonus, topup

scripts/
  mint-agents.ts                    # Mint ERC-8004 NFT cho mỗi skill
  seed-skills.ts                    # Seed skill registry vào DB
  transfer-agents-to-admin.ts       # Transfer skill NFTs về admin wallet
  diag-*.mjs                        # Diagnostic scripts

docs/
  ARCHITECTURE.md                   # Tổng quan kiến trúc
  ERC8183.md                        # Escrow flow chi tiết
  ERC8004.md                        # Identity / Reputation / Validation
  HERMES.md                         # AI orchestration
  CREDITS.md                        # Credit system
  MANUS_BRIEF.md                    # Brief cho bài viết kỹ thuật
```

## Architectural rules

1. One table per concept — no manifest/config/registry splits
2. Postgres is the only state store — no Redis, no in-memory queues
3. Hermes is stateless — each request re-reads messages from DB
4. All admin txs go through a serialized queue — no nonce collisions
5. Best-effort for on-chain side effects — reputation/validation failure never blocks workflow completion
6. Dead code deleted — no "just in case" components

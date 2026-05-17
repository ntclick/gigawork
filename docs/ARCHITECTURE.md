# GigaWork v2 — Architecture Overview

> **Manus note:** Vẽ sơ đồ tổng quan kiến trúc hệ thống với 3 layer: Client (browser/Privy), Backend (Next.js API), On-chain (Arc Testnet contracts). Dùng màu khác nhau cho mỗi layer.

## Tổng quan

GigaWork là nền tảng orchestrate AI agent với thanh toán on-chain, được xây trên **Arc Testnet**. Người dùng đặt một yêu cầu → Hermes (AI brain) lập kế hoạch và dispatch các skill agent → kết quả được settle on-chain qua smart contract ERC-8183 và uy tín được ghi nhận qua ERC-8004.

```
┌─────────────────────────────────────────────────────────────┐
│                         CLIENT                              │
│  Privy Wallet ──→ useEscrowPost ──→ WorkflowCanvas          │
│                                        ↕                    │
│               WorkflowDocPanel (trail UI)                   │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP / SSE
┌────────────────────────▼────────────────────────────────────┐
│                     NEXT.JS API                             │
│  /api/workflow        /api/workflow/[id]/stream             │
│  /api/workflow/escrow /api/workflow/[id]/reputation         │
│  /api/identity        /api/auth                             │
│                                                             │
│  lib/ai/brain.ts  ──→  lib/ai/tools.ts                      │
│  lib/ai/finalizeWorkflow.ts                                 │
└──────┬────────────────────────┬───────────────────────────── ┘
       │ viem                   │ viem
┌──────▼─────────────┐  ┌──────▼──────────────────────────────┐
│   POSTGRESQL DB     │  │         ARC TESTNET                 │
│  workflows          │  │  ERC-8183 AgenticCommerce           │
│  nodes              │  │  ERC-8004 ReputationRegistry        │
│  messages           │  │  ERC-8004 ValidationRegistry        │
│  skills             │  │  IdentityRegistry (ERC-721)         │
│  users              │  │  USDC Token                         │
│  credit_ledger      │  └─────────────────────────────────────┘
└─────────────────────┘
```

---

## Smart Contracts (Arc Testnet — Chain ID 5042002)

| Contract | Địa chỉ | Chuẩn | Vai trò |
|----------|---------|-------|---------|
| AgenticCommerce | `0x0747EEf0706327138c69792bF28Cd525089e4583` | ERC-8183 | Escrow, job lifecycle |
| ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | ERC-8004 | On-chain scoring |
| ValidationRegistry | `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` | ERC-8004 | Agent proof attestation |
| IdentityRegistry | `$IDENTITY_REGISTRY_ADDRESS` env | ERC-721 | Identity NFT |
| USDC | `0x3600000000000000000000000000000000000000` | ERC-20 | Gas token (6 dec) |

> **Manus note:** Vẽ sơ đồ quan hệ giữa 5 contract trên. AgenticCommerce dùng USDC. ReputationRegistry + ValidationRegistry thuộc ERC-8004 suite. IdentityRegistry cấp tokenId cho cả user và skill agent.

---

## Luồng chính (Happy Path)

> **Manus note:** Đây là sequence diagram quan trọng nhất. Vẽ theo chiều dọc với các actor: User/Browser, Next.js API, Arc Chain, PostgreSQL DB, Hermes AI.

```
User         Browser          Next.js API          Arc Chain        DB
 │                │                  │                   │           │
 │─ POST prompt ─→│                  │                   │           │
 │                │──POST /workflow──→│                   │           │
 │                │                  │── createJob tx ───→│           │
 │                │                  │                   │           │
 │                │←── workflowId ───│─── INSERT wf ────────────────→│
 │                │                  │   status=awaiting_fund         │
 │                │                  │                   │           │
 │  [Wallet popup #1: createJob]      │                   │           │
 │──── sign ─────→│── /escrow/post-create ─→ setBudget tx─→│           │
 │                │                  │                   │           │
 │  [Wallet popup #2: approve USDC]   │                   │           │
 │──── sign ─────→│                  │                   │           │
 │  [Wallet popup #3: fund]           │                   │           │
 │──── sign ─────→│──/escrow/confirm─→│                   │           │
 │                │                  │─── UPDATE wf ────────────────→│
 │                │                  │   status=planning              │
 │                │                  │                   │           │
 │                │──POST /stream ───→│                   │           │
 │                │       ┌──────────│                   │           │
 │                │       │ Hermes AI: planWorkflow       │           │
 │                │       │           dispatchSkill×N     │           │
 │                │       │           finalizeReport       │           │
 │                │       └──────────│                   │           │
 │                │                  │── submit + complete tx ───────→│
 │                │                  │   (ERC-8183 settle)│           │
 │                │                  │── giveFeedback tx ─→│           │
 │                │                  │   (ERC-8004 rep)   │           │
 │                │←── stream done ──│                   │           │
```

---

## Môi trường (Environment Variables)

### Required

| Biến | Mô tả |
|------|-------|
| `ARC_RPC_URL` | RPC chính của Arc Testnet |
| `ADMIN_PRIVATE_KEY` | Ví admin (provider + evaluator role trong ERC-8183) |
| `DATABASE_URL` | PostgreSQL connection string |
| `OPENAI_API_KEY` | API key cho Hermes AI brain |
| `IDENTITY_REGISTRY_ADDRESS` | Địa chỉ ERC-721 Identity Registry |

### ERC-8183 Escrow

| Biến | Default | Mô tả |
|------|---------|-------|
| `ERC8183_ENABLED` | `0` | Bật/tắt toàn bộ escrow flow |
| `ERC8183_USER_CLIENT` | `0` | `1` = user ký tx (Privy flow), `0` = admin tự fund |
| `ERC8183_BUDGET_USDC` | `0.05` | Budget mặc định mỗi workflow |
| `AGENTIC_COMMERCE_ADDRESS` | `0x0747...` | Override contract address |
| `NEXT_PUBLIC_USDC_ADDRESS` | `0x3600...` | USDC token address |

### ERC-8004 Reputation & Validation

| Biến | Default | Mô tả |
|------|---------|-------|
| `REPUTATION_REGISTRY_ADDRESS` | `0x8004B663...` | Override reputation contract |
| `VALIDATION_REGISTRY_ADDRESS` | _(none)_ | Nếu không set, bỏ qua validation |

### AI Provider

| Biến | Default | Mô tả |
|------|---------|-------|
| `AI_PROVIDER` | `openai` | `openai` / `kimi` / `deepseek` |
| `OPENAI_MODEL` | `gpt-4.1` | Model chính |
| `OPENAI_FALLBACK_MODEL` | `gpt-4o` | Fallback nếu model chính unavailable |

---

## Xem thêm

- [ERC-8183: Escrow Flow chi tiết](./ERC8183.md)
- [ERC-8004: Identity, Reputation, Validation](./ERC8004.md)
- [Hermes AI Orchestration](./HERMES.md)
- [Credits & Payments](./CREDITS.md)

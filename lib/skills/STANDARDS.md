# ERC-8004 + ERC-8183 Compliance Roadmap

This file documents how the v2 skills layer maps to the two ERC standards
GigaWork is designed around. **As of 2026-05, the on-chain ERC-8183
lifecycle is REAL** when `ERC8183_ENABLED=1` — every workflow opens a
job on the deployed AgenticCommerce contract, funds escrow, submits a
deliverable hash on finalize, and completes for settlement. The platform
admin wallet currently signs both client and provider sides; per-user
provider wallets are on the v3 roadmap.

---

## ERC-8183 — Agentic Commerce (workflow execution)

### State machine

| Stage in v2 | DB column | ERC-8183 stage | Status |
|---|---|---|---|
| User posts prompt | `workflows.status='planning'` | Open | ✅ in code |
| Brain calls `planWorkflow` | `nodes.status='pending'` | Job created | ✅ in code |
| Skill dispatched | `nodes.status='running'` | Funded → Submitted | ✅ in code |
| Skill returns OK | `nodes.status='completed'` | Completed | ✅ in code |
| Skill errors | `nodes.status='failed'` | Rejected | ✅ in code |
| Final report | `workflows.status='completed'` | Settled | ✅ in code |

### On-chain dispatch envelope

Every `dispatchSkill` tool call signs an ERC-8183-shaped envelope via
[`lib/chain/dispatch.ts`](../chain/dispatch.ts):

```json
{
  "standard": "ERC-8183",
  "kind": "pipeline.dispatch",
  "workflow_id": "uuid",
  "node_id": "uuid",
  "skill": "crypto-scanner",
  "cost_credits": 8,
  "identity_token_id": null,
  "ts": 1735689600
}
```

This is encoded as hex calldata in a 0-value self-tx so an explorer can decode
and prove the dispatch happened. `identity_token_id` will be non-null once
ERC-8004 minting is enabled.

### What's wired today (`ERC8183_ENABLED=1`)

Every workflow runs the full 5-step lifecycle on AgenticCommerce
`0x0747EEf0706327138c69792bF28Cd525089e4583`:

1. `createJob(provider=admin, evaluator=admin, expiredAt, description, hook=0)`
2. `setBudget(jobId, ERC8183_BUDGET_USDC, "0x")`
3. `USDC.approve(AgenticCommerce, budget)` from admin
4. `fund(jobId, "0x")` — workflow row updated with `erc8183_job_id` + `erc8183_create_tx` + `erc8183_fund_tx`
5. On `finalizeReport`: `submit(jobId, keccak256(workflow_id + summary), "0x")` then `complete(jobId, keccak256("workflow-completed"), "0x")`. Submit/complete tx hashes + the deliverable hash are persisted.

Logic lives in [`lib/chain/agenticCommerce.ts`](../chain/agenticCommerce.ts);
hooked from [`app/api/workflow/route.ts`](../../app/api/workflow/route.ts) (open + fund) and [`lib/ai/tools.ts`](../ai/tools.ts) `finalizeReport` (submit + complete).
The right-rail panel in `WorkflowDocPanel` renders all four explorer
links once they land.

### v3 — per-user provider wallets

1. Replace admin-as-provider with each skill's own `agentTokenId` owner wallet
2. Settle 95/5 USDC split to skill owner + treasury (currently both sides are admin so the split nets out)
3. One ERC-8183 job per skill dispatch instead of one per workflow, so each step has its own escrow + attestation

---

## ERC-8004 — Agent Identity (skill registration)

### Current state

Each skill has 3 fields in the `skills` table for ERC-8004 mint metadata:

| Column | Purpose | Filled? |
|---|---|---|
| `agent_token_id` | NFT token id assigned at mint | ⏳ blank |
| `agent_tx_hash` | Mint tx hash | ⏳ blank |
| `agent_minted_at` | Timestamp | ⏳ blank |

Plus the manifest carries the `owner_wallet` (`0x4c77584f57d385e0f2996bd4ff178c93dff034c0`)
that will collect dispatch fees once on-chain settlement is enabled.

### To enable ERC-8004 minting:

For each skill in `seed-skills.ts`:

1. Build metadata URI:
   ```ts
   const metadata = {
     type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
     name: skill.manifest.display_name,
     description: skill.manifest.description,
     services: [{
       name: 'gigawork',
       endpoint: skill.endpoint
     }]
   }
   const tokenURI = `data:application/json;base64,${btoa(JSON.stringify(metadata))}`
   ```
2. Call `IdentityRegistry.register(tokenURI)` from the skill's owner wallet
3. Capture `Transfer` event → token id
4. Update DB: `agent_token_id`, `agent_tx_hash`, `agent_minted_at`

Existing helpers in [`lib/chain/identity.ts`](../chain/identity.ts) already do
this for **user identity** — the same pattern can be reused for skill identity.
The contract address is in `IDENTITY_REGISTRY_ADDRESS` env var
(`0x8004A818BFB912233c491871b3d84c89A494BD9e` on Arc Testnet).

### When to do it

- **Now (v2.5):** keep the workflow logic 8183-compliant, skip mint
- **v3:** mint all 11 skills as ERC-8004 NFTs at deploy time, hook reputation
  updates from `nodes.status` transitions
- **v4:** open registration → anyone can deploy a skill + mint own NFT

---

## What the brain actually does today

[`lib/ai/tools.ts`](../ai/tools.ts) already calls `signDispatchTx` per skill —
the resulting tx hashes are persisted to `messages.toolPayload` so a future
audit can reconstruct the workflow on-chain.

The frontend shows the dispatch state (canvas node colors per node.status,
"Verified" pill on completed nodes) — this matches the eventual on-chain
attestation flow without users noticing the difference.

**TL;DR:** v2 already follows the standard's _state machine and envelope
format_. The remaining work is swapping stub calls for real contract calls
when ready — no architecture changes needed.

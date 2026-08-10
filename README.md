<p align="center">
  <img src="public/logo.svg" alt="GigaWork" width="260" />
</p>

<p align="center">
  Hire verified AI agents, pay them per call, keep the receipts on-chain.<br/>
  Built on Arc™ Network · Testnet
</p>

---

GigaWork turns an objective in plain English into a small workforce of AI agents that
actually get paid. You describe what you want, a planner picks the agents and their
arguments, each one is settled individually the moment it delivers, and every payment
leaves a transaction hash you can open in a block explorer.

The point is that none of it is theatre. The agents hold real ERC-8004 identity NFTs,
the money moves out of a wallet you control, and an agent that fails is never charged
for.

## How a run works

```
you                 "4h trading signals for SOL/USDT and a short report"
  │
  ├─ gate           ERC-8004 identity + vault balance checked on-chain.
  │                 Cannot pay → refused here, nothing is created.
  │
  ├─ plan           DeepSeek picks agents and arguments from the live registry.
  │                 Validated before it runs: real skill names, resolvable
  │                 dependencies, no sender unless you asked to be notified.
  │
  ├─ escrow         ERC-8183 job opened and funded from your vault.
  │
  ├─ work           Agents run in parallel. Each is paid by x402 transfer the
  │                 moment it delivers — a failed agent costs you nothing.
  │
  ├─ settle         Deliverable submitted on-chain, escrow released.
  │
  └─ score          Reputation written for every provider AND for you: under
                    ERC-8004 the client is an agent too, and paying well is
                    its own track record.
```

Typical cost of a three-agent run: **~$0.07 USDC** — $0.02 escrow plus per-call fees
of $0.01–0.03.

## What's real, and what isn't

Worth stating plainly, because "on-chain" is easy to claim:

| | |
|---|---|
| Agent identities | Real. 17 ERC-8004 NFTs, minted, linked from the home page to the explorer. |
| Payments | Real. Every settled call is an on-chain USDC transfer with a tx hash. |
| Escrow | Real ERC-8183 jobs, opened and funded by your own vault. |
| Agent data | Real APIs — Binance, CoinGecko, DeFiLlama, OpenSea, Alchemy, Apify. |
| Reports | Written by an LLM from those outputs, never templated. |
| The chain | **Arc Testnet.** Balances and payments are testnet value, not money. |

If a data source is unreachable, the agent fails and says so. It does not invent a
number to fill the gap.

## Surfaces

| Route | What it is |
|---|---|
| `/` | Objective box, 16 ready-made workflows in category tabs, live protocol readout, agent roster |
| `/workflow/:id` | The run: deliverable first, then the agent roster, log, payment trail and ERC-8004 scoring |
| `/billing` | Your vault and your connected wallet — deposit, swap, full ledger |
| `/deploy` | Schedules and notification channels |
| `/history` | Past runs |

## Two wallets

Easy to conflate, so:

- **Your connected wallet** signs. Swaps happen inside it; deposits come out of it.
- **Your vault** is a per-user wallet the server holds a key for. It pays the agents,
  so a run does not need a signature per agent call. Provisioned automatically,
  private key encrypted at rest with AES-256-GCM.

Arc bills gas in USDC at 18 decimals, which is *not* the same as the 6-decimal USDC
ERC-20. A vault can hold plenty of the latter and still be unable to transact. The run
gate checks both.

## Stack

| Layer | |
|---|---|
| Frontend | Next.js 16 App Router, React 19, Tailwind v4, TypeScript strict |
| Planner | DeepSeek `deepseek-v4-flash` (any OpenAI-compatible provider works) |
| Chain | Arc Testnet — chain 5042002, viem |
| Auth | Privy (embedded + external wallets) |
| Data | Supabase Postgres, Drizzle ORM |
| Swap | Circle App-Kit, Teller for USDC↔USYC |

## Contracts (Arc Testnet)

| Contract | Address |
|---|---|
| ERC-8004 Identity Registry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ERC-8183 Agentic Commerce | `0x0747EEf0706327138c69792bF28Cd525089e4583` |
| Reputation Registry | `0x711b4dea9a717210591aac47a3ec92ef8e695944` |
| ERC-8004 Validation Registry | `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` |
| USDC | `0x3600000000000000000000000000000000000000` |

Explorer: [testnet.arcscan.app](https://testnet.arcscan.app)

## Running it

Requires Node 20.9+ (Next 16's floor), pnpm, a Supabase Postgres URL, and an Arc
Testnet RPC.

```bash
pnpm install
cp .env.example .env.local     # then fill it in — see the notes below
pnpm db:push                   # schema
pnpm db:add-vault-cols         # per-user vault columns
pnpm db:add-topup-deposits     # deposit replay protection
pnpm db:seed                   # 17 skills
pnpm dev                       # http://localhost:5555
```

Three variables are worth calling out:

- **`WALLET_ENCRYPTION_KEY`** — base64, 32 bytes. Encrypts vault and agent private
  keys at rest. There is no default and the app refuses to start without it; that is
  deliberate. Generate one with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  ```
  Rotating it means re-encrypting: `pnpm security:reencrypt-wallets` and
  `pnpm security:reencrypt-notify`.
- **`ERC8183_BUDGET_USDC`** — escrow deposit per run. Default `0.05`; this deployment
  uses `0.02`.
- **`VAULT_MIN_GAS_USDC`** — native balance a vault must hold before a run may start.
  Default `0.05`, which covers roughly eight transactions at observed gas prices.

## Scripts

| Command | |
|---|---|
| `pnpm dev` | Dev server on :5555 (Turbopack) |
| `pnpm build` | Production build (webpack) |
| `pnpm db:seed` | Seed the skill registry |
| `pnpm security:reencrypt-wallets` | Re-encrypt wallet keys after a key rotation |
| `pnpm security:reencrypt-notify` | Same, for notification secrets |
| `pnpm worker:chain` | Optional worker draining the `chain_jobs` queue |
| `pnpm worker:workflow` | Optional background workflow worker |

The workers are a backstop, not a requirement — settlement and reputation both run
inline after a workflow finishes. They exist so a deployment can move that work off
the request path.

## Architecture notes

- [`AGENTS.md`](AGENTS.md) — read before writing code. This is Next.js 16; several
  APIs differ from what you may expect.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/ERC8004.md`](docs/ERC8004.md),
  [`docs/ERC8183.md`](docs/ERC8183.md)

## Trademarks

Built on Arc™ Network. Arc is a trademark of Circle Internet Group, Inc. and/or its
affiliates. GigaWork is not affiliated with or endorsed by Circle. The Arc logo is
deliberately not reproduced here — Circle's partner guidelines permit only unmodified
assets from their own brand kit.

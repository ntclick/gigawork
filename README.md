# GigaWork v2

Chat-driven AI workflow runner. Brain (Kimi K2 / Moonshot) plans steps → worker skills (HTTP) execute in parallel → brain composes a final report.

**v2 is chat-driven.** Privy wallet login, ERC-8004 identity mint, USDC → credit top-up, and an ERC-8183-shaped dispatch envelope are wired. ERC-8183 escrow/settle (`createJob → fund → submit → complete`) is **not yet on-chain** — see `lib/skills/STANDARDS.md` for the v3 roadmap.

## Architectural rules

1. One table per concept. Don't split skill into manifest+config+registry.
2. Supabase Postgres is the only state store. No in-memory queues, no Redis.
3. Brain is stateless. No memory/learning loop. Each prompt = fresh LLM call.
4. UI inline by default. Side panel collapsed; only opens on user click.
5. Dead code = deleted. No "just in case" components.

## Stack

- Next.js 16.2 (App Router, Turbopack, TypeScript strict)
- Tailwind CSS v4 + shadcn/ui
- Supabase Postgres + Drizzle ORM
- Vercel AI SDK 6 + `@ai-sdk/openai-compatible` (Kimi K2 via Moonshot)
- Privy auth + viem (Arc Testnet)
- `@xyflow/react` (lazy, canvas only)

## Setup

1. Copy env: `cp .env.example .env.local` and fill in:
   - `DATABASE_URL` — Supabase Postgres connection string (Settings → Database → URI, requires DB password)
   - `KIMI_API_KEY` (or `MOONSHOT_API_KEY`) — from https://platform.moonshot.ai/
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — from project settings
   - `NEXT_PUBLIC_PRIVY_APP_ID`, `NEXT_PUBLIC_PRIVY_CLIENT_ID` — Privy dashboard
   - `IDENTITY_REGISTRY_ADDRESS`, `ADMIN_PRIVATE_KEY` — only if minting ERC-8004 identity from server

2. Schema is already applied to the Supabase project. To regenerate from schema:
   ```
   pnpm db:generate
   pnpm db:push
   ```

3. Run dev:
   ```
   pnpm dev
   ```
   Open http://localhost:3000.

## Layout

```
app/
  (chat)/
    page.tsx                            # entry: textarea + 4 suggested prompts
    workflow/[id]/page.tsx              # chat page (useChat → /api/workflow/[id]/stream)
    layout.tsx                          # dark theme wrapper
  api/
    workflow/route.ts                   # POST: create workflow
    workflow/[id]/route.ts              # GET: workflow snapshot
    workflow/[id]/stream/route.ts       # POST: streamText with brain tools
    skills/route.ts                     # GET: list skills
    skills/[name]/route.ts              # POST: stub skill execute
components/
  chat/{Thread, BrainMessage, UserMessage, NegotiationCard, MiniDag, ReportCard, InputBox, SideRail}.tsx
  canvas/FullCanvas.tsx                 # lazy
  ui/                                    # shadcn primitives
lib/
  db/{schema,client}.ts                 # 4 tables: workflows, skills, nodes, messages
  ai/{brain,tools,prompts}.ts           # 3 tools: planWorkflow, dispatchSkill, finalizeReport
  skills/registry.ts
supabase/migrations/                    # drizzle output
```

## Brain tools

- **`planWorkflow`** — call once at start, lays out the DAG (nodes + depends_on).
- **`dispatchSkill`** — fetches the skill endpoint with input, updates the node row.
- **`finalizeReport`** — inserts the brain message + sets workflow.status='completed'.

The brain is stateless: each request reads messages from DB and re-streams.

'use client'

/**
 * HomePage — the landing surface.
 *
 * Every figure here is real: agent prices and status come from
 * /api/skills, workflow costs are summed from each template's declared
 * skill chain. When a price is missing the estimate is omitted rather
 * than invented.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { useLogin, usePrivy } from '@privy-io/react-auth'
import {
  Activity,
  Bot,
  Check,
  Cpu,
  Fingerprint,
  Gem,
  Loader2,
  Play,
  ScanSearch,
  Sprout,
  TrendingUp,
  Wallet,
  Waves,
  type LucideIcon,
} from 'lucide-react'

import { useIdentityMint, type MintStage } from '@/lib/hooks/useIdentityMint'
import { useTopup } from '@/lib/hooks/useTopup'
import { WORKFLOW_TEMPLATES, type WorkflowTemplate } from '@/lib/workflowTemplates'

interface Skill {
  slug: string
  name: string
  category: string
  pricePerCall: string
  status?: string
  totalCalls?: number
  agentTokenId?: string | null
}

interface Protocol {
  chainId: number
  explorer: string
  contracts: { key: string; label: string; address: string }[]
  stats: { minted: number; settledCount: number; settledUsdc: string; escrowJobs: number }
  recent: { skill: string; amountUsdc: string; txHash: string }[]
}

/**
 * Per-template glyph. The templates carry an `emoji` field, but emoji
 * render as someone else's artwork at whatever size and colour the OS
 * decides — these inherit the tile's accent and stroke weight instead.
 * Unknown ids fall back to a generic chip rather than an empty box.
 */
const TEMPLATE_ICON: Record<string, LucideIcon> = {
  'defi-yield-finder': Sprout,
  'token-scanner-valuation': ScanSearch,
  'trading-signals-sentinel': TrendingUp,
  'whale-tracker-report': Waves,
  'polymarket-pulse': Activity,
  'nft-floor-watch': Gem,
}

/** A launch the user has asked for but not yet paid for. */
interface PendingLaunch {
  prompt: string
  title: string
  /** Agent display names in the order they will be hired, if known. */
  chain: string[]
  /** Summed x402 price of that chain, or null when any price is unknown. */
  agentCost: number | null
}

function Stat({ v, k }: { v: string; k: string }) {
  return (
    <div className="gwt-stat">
      <div className="gwt-stat-v">{v}</div>
      <div className="gwt-stat-k">{k}</div>
    </div>
  )
}

/** What the mint is doing right now, in the user's words rather than the
 *  hook's state names. Silence during a three-call flow reads as a hang. */
const MINT_DETAIL: Partial<Record<MintStage, string>> = {
  preparing: 'Building the mint transaction…',
  signing: 'Waiting for you to approve it in your wallet.',
  confirming: 'Submitted — waiting for Arc Testnet to confirm.',
  done: 'Identity minted.',
}
const MINT_LABEL: Record<MintStage, string> = {
  idle: 'Mint identity',
  preparing: 'Preparing…',
  signing: 'Check your wallet…',
  confirming: 'Confirming…',
  done: 'Minted',
  error: 'Retry',
}
const TOPUP_LABEL: Record<string, string> = {
  signing: 'Check your wallet…',
  confirming: 'Confirming…',
  granting: 'Crediting…',
}

/**
 * GET a JSON endpoint, retrying a couple of times on failure.
 *
 * The page's data loads are one-shot on mount, and a cold dev/serverless
 * start answers /api/me and /api/skills with 503 for the first second or
 * two while the DB pool warms. That window used to leave the home page
 * permanently blank — no agents, no stats, no retry, no error. Backing
 * off twice covers the warm-up without turning into a poll.
 */
async function getJSON<T>(url: string, tries = 3): Promise<T | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { cache: 'no-store' })
      if (r.ok) return (await r.json()) as T
      // 4xx is an answer, not a warm-up — don't keep asking.
      if (r.status < 500) return null
    } catch {
      /* network flake — same backoff applies */
    }
    if (i < tries - 1) await new Promise((res) => setTimeout(res, 700 * (i + 1)))
  }
  return null
}

type StepState = 'done' | 'active' | 'todo'

function Step({
  n,
  state,
  icon: Icon,
  title,
  detail,
  action,
}: {
  n: number
  state: StepState
  icon: LucideIcon
  title: string
  detail: string
  action?: React.ReactNode
}) {
  return (
    <div className="gwt-step" data-state={state}>
      <span className="gwt-step-n">
        {state === 'done' ? <Check size={12} strokeWidth={3} /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="gwt-step-t flex items-center gap-1.5">
          <Icon size={13} strokeWidth={2} className="shrink-0 opacity-70" />
          {title}
        </div>
        <div className="gwt-step-d">{detail}</div>
        {state === 'active' && action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  )
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'bad' }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-white/40">{label}</span>
      <span className={tone === 'bad' ? 'text-[var(--gw-rose)]' : 'text-white/65'}>{value}</span>
    </div>
  )
}

const CAT_COLOR: Record<string, string> = {
  research: 'text-[var(--gw-cyan)]',
  'on-chain': 'text-[var(--gw-emerald)]',
  execution: 'text-[var(--gw-amber)]',
  analysis: 'text-[var(--gw-violet)]',
}

/** Same mapping as CAT_COLOR, as a raw value for the `--accent` custom
 *  property that drives a tile's edge, icon tint and hover glow. */
const CAT_ACCENT: Record<string, string> = {
  research: 'var(--gw-cyan)',
  'on-chain': 'var(--gw-emerald)',
  execution: 'var(--gw-amber)',
  analysis: 'var(--gw-violet)',
}

export function HomePage() {
  const router = useRouter()
  const [skills, setSkills] = useState<Skill[] | null>(null)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'mint' | 'topup' | 'error'; text: string } | null>(
    null,
  )
  const [runs, setRuns] = useState<number | null>(null)
  const [proto, setProto] = useState<Protocol | null>(null)
  const [me, setMe] = useState<{
    usdcBalance: number
    escrowBudgetUsdc: string
    hasIdentity: boolean
    tokenId: string | null
  } | null>(null)
  // Nothing is spent until this is confirmed. Creating a workflow funds the
  // ERC-8183 escrow on-chain, so the click that starts it has to state what
  // it costs first.
  const [pending, setPending] = useState<PendingLaunch | null>(null)
  const taRef = useRef<HTMLTextAreaElement | null>(null)

  const { ready: privyReady, authenticated } = usePrivy()
  const { login } = useLogin()
  // Surfacing the stage is the whole point: the mint takes three round
  // trips and a wallet signature, and with no feedback the button just
  // looked dead until the popup appeared.
  const [mintStage, setMintStage] = useState<MintStage>('idle')
  const [mintError, setMintError] = useState<string | null>(null)
  const { mint } = useIdentityMint((s, detail) => {
    setMintStage(s)
    if (s === 'error') setMintError(detail ?? 'mint failed')
  })
  const topup = useTopup()

  const loadMe = useCallback(async () => {
    const j = await getJSON<{
      usdcBalance: number
      escrowBudgetUsdc?: string
      identity?: { hasIdentity: boolean; tokenId: string | null }
    }>('/api/me')
    if (!j || typeof j.usdcBalance !== 'number') return
    setMe({
      usdcBalance: j.usdcBalance,
      escrowBudgetUsdc: j.escrowBudgetUsdc ?? '0.05',
      hasIdentity: !!j.identity?.hasIdentity,
      tokenId: j.identity?.tokenId ?? null,
    })
  }, [])

  const runMint = useCallback(async () => {
    setMintError(null)
    try {
      await mint()
      loadMe()
    } catch {
      /* the stage callback already carries the reason */
    }
  }, [mint, loadMe])

  useEffect(() => {
    void getJSON<{ skills?: Skill[] } | Skill[]>('/api/skills').then((j) => {
      const list: Skill[] = Array.isArray(j) ? j : (j?.skills ?? [])
      if (list.length) setSkills(list)
    })
    void getJSON<{ workflows?: unknown[] }>('/api/workflows').then((j) => {
      if (j) setRuns((j.workflows ?? []).length)
    })
    void getJSON<Protocol>('/api/protocol').then((j) => j && setProto(j))
    void loadMe()
  }, [loadMe])

  // Re-read after a mint or a deposit so the onboarding rail advances
  // without a page reload — both flows dispatch these events.
  useEffect(() => {
    const on = () => loadMe()
    window.addEventListener('gw:identity-changed', on)
    window.addEventListener('gw:credits-changed', on)
    return () => {
      window.removeEventListener('gw:identity-changed', on)
      window.removeEventListener('gw:credits-changed', on)
    }
  }, [loadMe])

  const bySlug = new Map((skills ?? []).map((s) => [s.slug, s]))
  const online = (skills ?? []).filter((s) => s.status === 'online').length

  const costOf = (t: WorkflowTemplate): string | null => {
    if (!skills) return null
    let total = 0
    for (const slug of t.uses ?? []) {
      const p = parseFloat(bySlug.get(slug)?.pricePerCall ?? '')
      if (!Number.isFinite(p)) return null
      total += p
    }
    return total > 0 ? `$${total.toFixed(2)}` : null
  }

  const launch = useCallback(
    async (text: string) => {
      const objective = text.trim()
      if (!objective || busy) return
      setBusy(true)
      setNotice(null)
      setPending(null)
      try {
        const res = await fetch('/api/workflow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: objective }),
        })
        if (res.ok) {
          const { id } = await res.json()
          // `run=1` tells the run surface to dispatch the workforce as soon
          // as the plan has nodes, so the confirmed launch carries through to
          // a finished report without a second click. Planning is async, so
          // this can't be executed from here — there'd be nothing to run yet.
          router.push(`/workflow/${id}?run=1`)
          return
        }
        const j = await res.json().catch(() => ({}) as Record<string, unknown>)
        if (j.error === 'identity_required') {
          setNotice({
            kind: 'mint',
            text: 'You need an ERC-8004 identity NFT before running a workflow.',
          })
        } else if (j.error === 'insufficient_usdc') {
          const bal = typeof j.usdcBalance === 'number' ? j.usdcBalance : 0
          setNotice({
            kind: 'topup',
            text: `Your vault holds $${bal.toFixed(2)} USDC — not enough to open the escrow.`,
          })
        } else {
          setNotice({
            kind: 'error',
            text: String(j.message ?? j.error ?? `Request failed (${res.status})`),
          })
        }
      } catch (e) {
        setNotice({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
      } finally {
        setBusy(false)
      }
    },
    [busy, router],
  )

  /** Stage a launch for confirmation. Costs nothing until confirmed. */
  const ask = (p: PendingLaunch) => {
    if (busy || !p.prompt.trim()) return
    setNotice(null)
    setPending(p)
  }

  // A freeform objective has no declared skill chain — the planner picks the
  // agents. Its agent cost is genuinely unknown at this point, so it is left
  // null and the dialog says so rather than quoting a made-up figure.
  const askFreeform = () =>
    ask({ prompt, title: prompt.trim().slice(0, 90), chain: [], agentCost: null })

  const escrow = parseFloat(me?.escrowBudgetUsdc ?? '')
  const escrowCost = Number.isFinite(escrow) ? escrow : null

  const mintBusy = mintStage === 'preparing' || mintStage === 'signing' || mintStage === 'confirming'
  const topupBusy = ['signing', 'confirming', 'granting'].includes(topup.step)
  const funded = !!me && me.usdcBalance > 0
  // Gated on what the account can actually do, not on the wallet widget:
  // an identity plus a funded vault means the API will accept a launch, so
  // the rail has nothing left to ask for. Keying it on `authenticated` too
  // left a ready account staring at an active "connect your wallet" step
  // beside two completed ones. Held until Privy is `ready` so the rail
  // doesn't flash at users who are already set up.
  const onboarding = privyReady && (!me?.hasIdentity || !funded)
  const totalCost =
    pending && pending.agentCost !== null && escrowCost !== null
      ? pending.agentCost + escrowCost
      : null
  const short = totalCost !== null && me !== null && me.usdcBalance < totalCost

  return (
    <main className="gwt-page">
      {/* ── Hero ───────────────────────────────────────────────── */}
      <section className="gwt-hero">
        <span className="gwt-sweep" aria-hidden />
        <div className="gwt-hero-inner">
          <span className="gwt-eyebrow">
            <span className="gwt-pulse" />
            {skills === null
              ? 'connecting to the agent registry…'
              : `${online} of ${skills.length} agents online · Arc Testnet`}
          </span>

          <h1 className="gwt-display">
            Supervise your
            <br />
            <em>autonomous AI company.</em>
          </h1>

          <p className="gwt-lede">
            Describe an objective. Hermes plans the workforce, hires verified ERC-8004 agents, opens
            an ERC-8183 escrow from your vault, settles every agent call on-chain via x402, and
            returns one report.
          </p>

          <div className="gwt-stats">
            <Stat v={skills === null ? '—' : String(online)} k="agents online" />
            <Stat v={runs === null ? '—' : String(runs)} k="runs executed" />
            <Stat v={me ? `$${me.usdcBalance.toFixed(2)}` : '—'} k="vault balance" />
            <Stat v={escrowCost === null ? '—' : `$${escrowCost.toFixed(2)}`} k="escrow per run" />
          </div>

          {onboarding && (
            <div className="gwt-rail">
              <Step
                n={1}
                state={authenticated ? 'done' : 'active'}
                icon={Wallet}
                title="Connect your wallet"
                detail="Arc Testnet, chain 5042002. Nothing is signed at this step."
                action={
                  <button className="gwt-btn !py-1.5 !px-3.5" onClick={() => login()}>
                    Connect wallet
                  </button>
                }
              />
              <Step
                n={2}
                state={
                  me?.hasIdentity ? 'done' : authenticated ? 'active' : 'todo'
                }
                icon={Fingerprint}
                title={
                  me?.hasIdentity ? `ERC-8004 identity #${me.tokenId}` : 'Mint your ERC-8004 identity'
                }
                detail={
                  mintError
                    ? mintError
                    : MINT_DETAIL[mintStage] ??
                      'A one-off NFT that proves who hired the agents. Minted to your wallet, one signature.'
                }
                action={
                  <button
                    className="gwt-btn !py-1.5 !px-3.5"
                    disabled={mintBusy}
                    onClick={runMint}
                  >
                    {mintBusy ? (
                      <>
                        <Loader2 size={13} className="gwt-spin" />
                        {MINT_LABEL[mintStage]}
                      </>
                    ) : (
                      <>
                        <Fingerprint size={13} />
                        {mintError ? 'Try mint again' : 'Mint identity'}
                      </>
                    )}
                  </button>
                }
              />
              <Step
                n={3}
                state={
                  funded ? 'done' : me?.hasIdentity ? 'active' : 'todo'
                }
                icon={Cpu}
                title="Fund your vault"
                detail={`Your own on-chain vault pays the agents. A run costs about $${
                  escrowCost === null ? '0.07' : (escrowCost + 0.05).toFixed(2)
                }.`}
                action={
                  <button
                    className="gwt-btn !py-1.5 !px-3.5"
                    disabled={topupBusy}
                    onClick={() => topup.topup(5)}
                  >
                    {topupBusy ? (
                      <>
                        <Loader2 size={13} className="gwt-spin" />
                        {TOPUP_LABEL[topup.step] ?? 'Depositing…'}
                      </>
                    ) : (
                      <>
                        <Wallet size={13} />
                        Deposit $5
                      </>
                    )}
                  </button>
                }
              />
            </div>
          )}

          <div className="gwt-compose">
            <textarea
              ref={taRef}
              rows={3}
              value={prompt}
              disabled={busy}
              spellCheck={false}
              placeholder="e.g. Hunt the top 5 DeFi stablecoin pools by APY with TVL over $1M and write me a risk-adjusted report"
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  askFreeform()
                }
              }}
            />
            <div className="gwt-compose-bar">
              <span className="text-[11px] text-white/25">
                Enter to launch · Shift+Enter for a new line
              </span>
              <button className="gwt-btn" disabled={busy || !prompt.trim()} onClick={askFreeform}>
                {busy ? (
                  <>
                    <Loader2 size={13} className="gwt-spin" />
                    Thinking…
                  </>
                ) : (
                  <>
                    <Play size={13} strokeWidth={2.5} />
                    Launch workforce
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </section>

      <div className="gwt-wrap">
        {pending && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            onClick={() => setPending(null)}
          >
            <div
              className="gwt-panel w-full max-w-md text-[12px]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="gwt-panel-bar">
                <span>confirm launch</span>
                <button className="gwt-token" onClick={() => setPending(null)}>
                  esc
                </button>
              </div>

              <div className="space-y-3 p-4">
                <div className="font-semibold text-white/85">{pending.title}</div>

                {pending.chain.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {pending.chain.map((n) => (
                      <span key={n} className="gwt-chip">
                        🤖 {n}
                      </span>
                    ))}
                  </div>
                )}

                <div className="space-y-1 border-t border-white/8 pt-3">
                  <Row
                    label="ERC-8183 escrow deposit"
                    value={escrowCost === null ? 'unknown' : `$${escrowCost.toFixed(2)}`}
                  />
                  <Row
                    label={
                      pending.chain.length
                        ? `Agent fees — ${pending.chain.length} listed × x402`
                        : 'Agent fees — x402 per call'
                    }
                    value={
                      pending.agentCost === null
                        ? 'set by the plan'
                        : `≈ $${pending.agentCost.toFixed(2)}`
                    }
                  />
                  <div className="flex items-baseline justify-between border-t border-white/8 pt-2 font-semibold">
                    <span className="text-white/70">Estimated charge</span>
                    <span className="text-[var(--gw-cyan)]">
                      {totalCost === null ? '≈ $0.07 USDC' : `≈ $${totalCost.toFixed(2)} USDC`}
                    </span>
                  </div>
                  {me && (
                    <Row
                      label="Vault balance"
                      value={`$${me.usdcBalance.toFixed(2)}`}
                      tone={short ? 'bad' : undefined}
                    />
                  )}
                </div>

                <p className="text-white/35">
                  {/* Only ever an estimate: the escrow deposit is exact, but the
                      planner is free to hire agents the template does not list —
                      a 2-skill template has run with 3 agents — so the fee side
                      can come out higher. Quoting it as a firm total would be a
                      claim the system cannot keep. */}
                  {pending.agentCost === null
                    ? 'The planner picks the agents, so fees are only known once the plan exists. The escrow deposit is exact. Failed agents are never charged.'
                    : 'The escrow deposit is exact; fees are an estimate — the planner may hire agents beyond the ones listed above. Failed agents are never charged.'}{' '}
                  Confirming runs the whole workflow through to a finished report — no further clicks.
                </p>

                {short && (
                  <p className="text-[var(--gw-rose)]">
                    Your vault is below the estimate. The launch will likely stop at the escrow.
                  </p>
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    className="gwt-btn"
                    disabled={busy}
                    onClick={() => launch(pending.prompt)}
                  >
                    {busy ? (
                      <>
                        <Loader2 size={13} className="gwt-spin" />
                        Thinking…
                      </>
                    ) : (
                      <>
                        <Play size={13} strokeWidth={2.5} />
                        Confirm &amp; run
                      </>
                    )}
                  </button>
                  <button className="gwt-token" onClick={() => setPending(null)}>
                    cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {notice && (
          <div
            className={`mt-3 flex flex-wrap items-center gap-3 rounded border px-3 py-2 text-[12px] ${
              notice.kind === 'error'
                ? 'border-[rgba(244,63,94,.3)] bg-[rgba(244,63,94,.07)] text-[var(--gw-rose)]'
                : 'border-[rgba(245,158,11,.3)] bg-[rgba(245,158,11,.07)] text-[var(--gw-amber)]'
            }`}
          >
            <span>{notice.text}</span>
            {notice.kind === 'mint' && (
              <button
                className="gwt-btn !py-1 !px-3"
                onClick={async () => {
                  try {
                    await mint()
                    setNotice(null)
                    launch(prompt)
                  } catch {
                    /* the hook surfaces the reason */
                  }
                }}
              >
                Mint identity
              </button>
            )}
            {notice.kind === 'topup' && (
              <button
                className="gwt-btn !py-1 !px-3"
                onClick={async () => {
                  await topup.topup(5)
                  setNotice(null)
                }}
              >
                Deposit $5
              </button>
            )}
          </div>
        )}

        {/* ── Ready-made workflows ─────────────────────────────── */}
        <div className="gwt-h">Ready-made workflows</div>
        <div className="gwt-grid2">
          {WORKFLOW_TEMPLATES.map((t) => {
            const chain = t.uses ?? []
            const cost = costOf(t)
            const Icon = TEMPLATE_ICON[t.id] ?? Cpu
            return (
              <button
                key={t.id}
                className="gwt-tile"
                style={{ '--accent': CAT_ACCENT[t.category] ?? 'var(--gw-cyan)' } as CSSProperties}
                disabled={busy}
                onClick={() => {
                  setPrompt(t.prompt)
                  ask({
                    prompt: t.prompt,
                    title: t.title,
                    chain: chain.map((s) => bySlug.get(s)?.name ?? s),
                    agentCost: cost === null ? null : parseFloat(cost.replace('$', '')),
                  })
                }}
              >
                <div className="flex items-center gap-3">
                  <span className="gwt-ico">
                    <Icon size={17} strokeWidth={1.75} />
                  </span>
                  <span className="gwt-tile-cat">{t.category}</span>
                </div>

                <div className="gwt-tile-title">{t.title}</div>
                <p className="gwt-tile-desc">{t.desc}</p>

                <div className="flex flex-wrap gap-1.5">
                  {chain.map((slug) => (
                    <span key={slug} className="gwt-chip">
                      <Bot size={10} strokeWidth={2} className="opacity-60" />
                      {bySlug.get(slug)?.name ?? slug}
                    </span>
                  ))}
                </div>

                <div className="gwt-tile-foot">
                  <span className="flex items-center gap-1.5">
                    <Play size={10} strokeWidth={2.5} className="opacity-50" />
                    {chain.length} agent{chain.length === 1 ? '' : 's'}
                  </span>
                  {/* "~" because the planner can hire beyond the declared chain
                      — the same caveat the confirm dialog states. */}
                  {cost && <span className="gwt-cost">~{cost}</span>}
                </div>
              </button>
            )
          })}
        </div>

        {/* ── Protocol ─────────────────────────────────────────── */}
        {proto && (
          <>
            <div className="gwt-h">Protocol · live on Arc Testnet</div>
            <div className="gwt-proto">
              <div className="gwt-panel">
                <div className="gwt-panel-bar">
                  <span>deployed contracts</span>
                  <span className="text-white/25">chain {proto.chainId}</span>
                </div>
                {proto.contracts.map((c) => (
                  <div key={c.key} className="gwt-wire">
                    <span className="text-white/50">{c.label}</span>
                    <a
                      className="gwt-addr"
                      href={`${proto.explorer}/address/${c.address}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {c.address.slice(0, 8)}…{c.address.slice(-6)}
                    </a>
                  </div>
                ))}
                <div className="gwt-wire">
                  <span className="text-white/50">Identities minted</span>
                  <span className="tabular-nums text-white/80">{proto.stats.minted}</span>
                </div>
                <div className="gwt-wire">
                  <span className="text-white/50">Escrow jobs opened</span>
                  <span className="tabular-nums text-white/80">{proto.stats.escrowJobs}</span>
                </div>
              </div>

              <div className="gwt-panel">
                <div className="gwt-panel-bar">
                  <span>x402 settlements</span>
                  <span className="text-white/25">
                    {proto.stats.settledCount} paid · ${proto.stats.settledUsdc} total
                  </span>
                </div>
                {proto.recent.length === 0 ? (
                  <div className="p-3 text-[12px] text-white/30">
                    No agent has been paid on-chain yet.
                  </div>
                ) : (
                  proto.recent.map((r) => (
                    <div key={r.txHash} className="gwt-feed-row">
                      <span className="gwt-live" />
                      <span className="min-w-0 flex-1 truncate text-white/60">{r.skill}</span>
                      <span className="tabular-nums font-semibold text-[var(--gw-emerald)]">
                        ${r.amountUsdc}
                      </span>
                      <a
                        className="gwt-addr shrink-0"
                        href={`${proto.explorer}/tx/${r.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {r.txHash.slice(0, 10)}…
                      </a>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}

        {/* ── Agent workforce ──────────────────────────────────── */}
        <div className="gwt-h">Agent workforce · ERC-8004 verified</div>
        {skills === null ? (
          <div className="text-[12px] text-white/30">loading the registry…</div>
        ) : (
          <div className="gwt-agents">
            {skills.map((s) => (
              <div key={s.slug} className="gwt-agent-tile">
                <div className="flex items-center gap-2">
                  <span className="gwt-dot" data-on={s.status === 'online' ? '1' : '0'} />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-white/80">
                    {s.name}
                  </span>
                  <span className="shrink-0 text-[11px] font-semibold tabular-nums text-white/65">
                    ${s.pricePerCall}
                  </span>
                </div>
                <div className="flex items-baseline justify-between text-[10.5px]">
                  <span className={CAT_COLOR[s.category] ?? 'text-white/35'}>{s.category}</span>
                  <span className="text-white/25 tabular-nums">{s.totalCalls ?? 0} calls</span>
                </div>
                {/* The identity token is the checkable part of "verified
                    agent" — link it rather than asserting it. */}
                {s.agentTokenId && proto && (
                  <a
                    className="gwt-addr text-[10px]"
                    href={`${proto.explorer}/token/${
                      proto.contracts.find((c) => c.key === 'identity')?.address ?? ''
                    }/instance/${s.agentTokenId}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    ERC-8004 #{s.agentTokenId} ↗
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}

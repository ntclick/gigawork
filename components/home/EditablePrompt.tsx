'use client'

/**
 * EditablePrompt — renders a slotted prompt with clickable variable chips.
 *
 *   "Scan $BTC on ${chain:ethereum}…"
 *
 * Each `$BTC` / `${chain:ethereum}` becomes a colored pill the user clicks
 * to open a picker popover. Pickers vary by slot kind:
 *   - token     → search input + CoinGecko results from /api/tokens/search
 *   - chain     → static enum dropdown
 *   - timeframe → static enum dropdown
 *   - wallet    → free-text + paste-from-clipboard helper
 *   - others    → free-text input
 *
 * The component is controlled — parent owns `segments` state. Submit logic
 * (the SEND button) lives in the parent so it can reuse the existing
 * /api/workflow flow + Plan A escrow trigger.
 */

import { useEffect, useRef, useState } from 'react'
import { Loader2, X } from 'lucide-react'

import {
  CHAIN_OPTIONS,
  type Segment,
  type Slot,
  type SlotKind,
  SLOT_KIND_COLORS,
  SLOT_KIND_LABELS,
  TIMEFRAME_OPTIONS,
  setSlotValue as setSlotValueImmutable,
} from '@/lib/slottedPrompt'

interface Props {
  segments: Segment[]
  onChange: (next: Segment[]) => void
  /** Show "edit raw" affordance — when toggled on, parent should swap to a
   *  plain textarea bound to the serialized prompt. */
  onEditRaw?: () => void
}

export function EditablePrompt({ segments, onChange, onEditRaw }: Props) {
  const [openSlotId, setOpenSlotId] = useState<string | null>(null)

  return (
    <div
      className="relative min-h-[110px] w-full text-lg leading-relaxed text-white sm:text-xl"
      style={{ wordBreak: 'break-word' }}
    >
      {segments.map((seg, i) => {
        if (seg.type === 'text') {
          // Preserve newlines + whitespace so multi-line templates stay legible
          return (
            <span key={`t${i}`} style={{ whiteSpace: 'pre-wrap' }}>
              {seg.value}
            </span>
          )
        }
        const { slot } = seg
        return (
          <SlotChip
            key={slot.id}
            slot={slot}
            open={openSlotId === slot.id}
            onOpen={() => setOpenSlotId(slot.id)}
            onClose={() => setOpenSlotId(null)}
            onChange={(nextValue) => {
              onChange(setSlotValueImmutable(segments, slot.id, nextValue))
              setOpenSlotId(null)
            }}
          />
        )
      })}

      {onEditRaw && (
        <div className="absolute right-0 top-0">
          <button
            type="button"
            onClick={onEditRaw}
            className="text-[10px] uppercase tracking-wider text-white/40 hover:text-white/70"
          >
            edit raw
          </button>
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// Slot chip
// ════════════════════════════════════════════════════════════════

interface SlotChipProps {
  slot: Slot
  open: boolean
  onOpen: () => void
  onClose: () => void
  onChange: (next: string) => void
}

function SlotChip({ slot, open, onOpen, onClose, onChange }: SlotChipProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const colorClasses = SLOT_KIND_COLORS[slot.kind]
  const display = slot.cashtag && /^[A-Z][A-Z0-9]{0,9}$/.test(slot.value) ? `$${slot.value}` : slot.value

  // Close popover on outside click
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open, onClose])

  return (
    <span ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={open ? onClose : onOpen}
        className={`mx-0.5 inline-block cursor-pointer rounded border px-1.5 py-0 align-baseline font-mono text-[0.85em] transition ${colorClasses}`}
      >
        {display || `<${slot.kind}>`}
      </button>

      {open && (
        <SlotPicker
          kind={slot.kind}
          currentValue={slot.value}
          onPick={onChange}
          onClose={onClose}
        />
      )}
    </span>
  )
}

// ════════════════════════════════════════════════════════════════
// Picker — varies by kind
// ════════════════════════════════════════════════════════════════

interface PickerProps {
  kind: SlotKind
  currentValue: string
  onPick: (next: string) => void
  onClose: () => void
}

function SlotPicker({ kind, currentValue, onPick, onClose }: PickerProps) {
  return (
    <div
      className="absolute left-0 top-full z-30 mt-1 w-72 border-2 border-black bg-[#0f131c] p-3 text-sm text-white shadow-[6px_6px_0_0_#000]"
      // Stop click propagation so the outside-click handler in the chip
      // doesn't immediately close while the user is interacting with the picker
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-white/55">
          {SLOT_KIND_LABELS[kind]}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-white/40 hover:text-white/80"
          aria-label="close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {kind === 'token' && (
        <TokenPicker currentValue={currentValue} onPick={onPick} />
      )}
      {kind === 'chain' && (
        <EnumPicker
          options={CHAIN_OPTIONS}
          currentValue={currentValue}
          onPick={onPick}
        />
      )}
      {kind === 'timeframe' && (
        <EnumPicker
          options={TIMEFRAME_OPTIONS}
          currentValue={currentValue}
          onPick={onPick}
        />
      )}
      {(kind === 'wallet' || kind === 'address') && (
        <FreeTextPicker
          currentValue={currentValue}
          onPick={onPick}
          placeholder={kind === 'wallet' ? '0x… or wallet name' : '0x… contract address'}
          allowPaste
        />
      )}
      {(kind === 'text' || kind === 'number') && (
        <FreeTextPicker
          currentValue={currentValue}
          onPick={onPick}
          placeholder={kind === 'number' ? 'Enter number' : 'Enter text'}
          numeric={kind === 'number'}
        />
      )}
    </div>
  )
}

// ─── Token picker (DB-backed) ───────────────────────────────────
interface TokenHit {
  id: string
  symbol: string
  name: string
  image: string | null
  marketCapRank: number | null
}

function TokenPicker({ currentValue, onPick }: { currentValue: string; onPick: (next: string) => void }) {
  const [q, setQ] = useState('')
  const [tokens, setTokens] = useState<TokenHit[] | null>(null)
  const [loading, setLoading] = useState(false)

  // Debounced fetch — token universe doesn't move minute-to-minute, server
  // caches 5 min, but we still don't want to fire on every keystroke.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const t = setTimeout(() => {
      fetch(`/api/tokens/search?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((j: { tokens: TokenHit[] }) => {
          if (cancelled) return
          setTokens(j.tokens)
        })
        .catch(() => {
          if (!cancelled) setTokens([])
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 220)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [q])

  return (
    <div>
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
        placeholder="Search BTC, Solana, $ARC…"
        className="mb-2 w-full border-2 border-black bg-[var(--giga-panel)] px-2 py-1 text-sm text-white outline-none placeholder:text-white/30 focus:border-[var(--giga-accent)]"
      />
      <div className="max-h-56 space-y-0.5 overflow-y-auto">
        {loading && (!tokens || tokens.length === 0) && (
          <div className="flex items-center gap-2 px-2 py-3 text-white/55">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Đang tìm…
          </div>
        )}
        {tokens?.map((t) => {
          const sym = t.symbol.toUpperCase()
          const isCurrent =
            currentValue.toLowerCase() === t.symbol.toLowerCase() ||
            currentValue.toLowerCase() === t.name.toLowerCase()
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onPick(sym)}
              className={`flex w-full items-center gap-2 border border-transparent px-2 py-1.5 text-left transition hover:border-cyan-400/40 hover:bg-cyan-400/10 ${
                isCurrent ? 'border-cyan-400/40 bg-cyan-400/15' : ''
              }`}
            >
              {t.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.image} alt="" className="h-5 w-5 shrink-0" />
              ) : (
                <span className="inline-block h-5 w-5 shrink-0 border border-white/15 bg-white/5" />
              )}
              <span className="font-mono text-cyan-300">${sym}</span>
              <span className="truncate text-white/70">{t.name}</span>
              {t.marketCapRank && (
                <span className="ml-auto shrink-0 text-[10px] text-white/40">
                  #{t.marketCapRank}
                </span>
              )}
            </button>
          )
        })}
        {tokens?.length === 0 && !loading && (
          <div className="px-2 py-3 text-center text-white/40">Không tìm thấy.</div>
        )}
      </div>
    </div>
  )
}

// ─── Enum picker (chain, timeframe) ─────────────────────────────
function EnumPicker({
  options,
  currentValue,
  onPick,
}: {
  options: Array<{ value: string; label: string }>
  currentValue: string
  onPick: (next: string) => void
}) {
  return (
    <div className="space-y-0.5">
      {options.map((o) => {
        const isCurrent = currentValue === o.value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onPick(o.value)}
            className={`flex w-full items-center justify-between border border-transparent px-2 py-1.5 text-left transition hover:border-emerald-400/40 hover:bg-emerald-400/10 ${
              isCurrent ? 'border-emerald-400/40 bg-emerald-400/15' : ''
            }`}
          >
            <span className="text-white/85">{o.label}</span>
            <span className="font-mono text-[11px] text-white/40">{o.value}</span>
          </button>
        )
      })}
    </div>
  )
}

// ─── Free-text (wallet, address, text, number) ──────────────────
function FreeTextPicker({
  currentValue,
  onPick,
  placeholder,
  allowPaste,
  numeric,
}: {
  currentValue: string
  onPick: (next: string) => void
  placeholder: string
  allowPaste?: boolean
  numeric?: boolean
}) {
  const [v, setV] = useState(currentValue)

  return (
    <div>
      <input
        type={numeric ? 'number' : 'text'}
        value={v}
        onChange={(e) => setV(e.target.value)}
        autoFocus
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onPick(v.trim())
          }
        }}
        className="mb-2 w-full border-2 border-black bg-[var(--giga-panel)] px-2 py-1 text-sm text-white outline-none placeholder:text-white/30 focus:border-[var(--giga-accent)]"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onPick(v.trim())}
          className="flex-1 border-2 border-black bg-[var(--giga-accent)] px-2 py-1 text-xs font-bold text-black hover:bg-yellow-300"
        >
          Save
        </button>
        {allowPaste && (
          <button
            type="button"
            onClick={async () => {
              try {
                const text = (await navigator.clipboard.readText()).trim()
                if (text) setV(text)
              } catch {
                /* clipboard blocked — user can type manually */
              }
            }}
            className="border border-white/15 px-2 py-1 text-xs text-white/65 hover:text-white"
          >
            Paste
          </button>
        )}
      </div>
    </div>
  )
}

// Re-export for convenience — parents typically also need parseSlottedPrompt
// + serializeSlottedPrompt right alongside the component
export { parseSlottedPrompt, serializeSlottedPrompt } from '@/lib/slottedPrompt'

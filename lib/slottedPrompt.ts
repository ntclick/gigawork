/**
 * Slotted prompt — a templated string with editable variable slots.
 *
 * Two grammars supported in the same string:
 *
 *   1. Cashtag shorthand: `$BTC`, `$ETH` — uppercase letters/digits after a
 *      `$`, NOT preceded by another `$` (so `$$x` is literal). Always treated
 *      as `kind: 'token'` with the cashtag as default value.
 *
 *   2. Explicit slots: `${kind:default}` — kind is one of the SLOT_KINDS.
 *      Example: `${chain:ethereum}`, `${timeframe:24h}`, `${wallet:0x...}`.
 *
 * Anything else is treated as plain text. Parsed into a flat array of
 * segments which the EditablePrompt component renders. Round-trip safe:
 * `serialize(parse(s))` may not equal `s` exactly (cashtags become explicit
 * `${token:X}` after first edit) but the rendered prompt to the brain is
 * stable and human-readable either way.
 */

export type SlotKind = 'token' | 'chain' | 'timeframe' | 'wallet' | 'address' | 'number' | 'text'

export interface Slot {
  /** Stable id for React keys + popover targeting (segments-local, not global). */
  id: string
  kind: SlotKind
  /** Current value (initially the default from the template). */
  value: string
  /** Original token-style spelling, used to render `$BTC` for cashtags. */
  cashtag?: boolean
}

export type Segment =
  | { type: 'text'; value: string }
  | { type: 'slot'; slot: Slot }

const KNOWN_KINDS: ReadonlySet<SlotKind> = new Set([
  'token',
  'chain',
  'timeframe',
  'wallet',
  'address',
  'number',
  'text',
])

/**
 * Parse a slotted prompt template into segments. Pure function — no I/O.
 *
 * Cashtag rule: `$XXX` matches when XXX is 1..10 uppercase ASCII letters/
 * digits AND the preceding character is not `$` (escape). Lowercase
 * cashtags (`$btc`) are NOT matched — keep them literal. Templates use
 * uppercase for tokens (`$BTC`), which is also the Twitter convention.
 */
export function parseSlottedPrompt(template: string): Segment[] {
  const segments: Segment[] = []
  const pattern = /\$\{([a-z]+):([^}]*)\}|(?<!\$)\$([A-Z][A-Z0-9]{0,9})\b/g

  let lastIndex = 0
  let slotCounter = 0
  let m: RegExpExecArray | null

  while ((m = pattern.exec(template)) !== null) {
    const [full, explicitKind, explicitValue, cashtag] = m
    const start = m.index

    if (start > lastIndex) {
      segments.push({ type: 'text', value: template.slice(lastIndex, start) })
    }

    if (cashtag) {
      segments.push({
        type: 'slot',
        slot: {
          id: `s${slotCounter++}`,
          kind: 'token',
          value: cashtag,
          cashtag: true,
        },
      })
    } else {
      const kind = (KNOWN_KINDS.has(explicitKind as SlotKind) ? explicitKind : 'text') as SlotKind
      segments.push({
        type: 'slot',
        slot: {
          id: `s${slotCounter++}`,
          kind,
          value: explicitValue ?? '',
          cashtag: false,
        },
      })
    }

    lastIndex = start + full.length
  }

  if (lastIndex < template.length) {
    segments.push({ type: 'text', value: template.slice(lastIndex) })
  }

  return segments
}

/**
 * Render segments back to a plain prompt the brain can ingest. Cashtag
 * tokens stay as `$X` if their value is unchanged from the original
 * cashtag and remains uppercase; otherwise we emit the value inline (so
 * `$BTC` → "Bitcoin" if user picked a longer name). Other slots are
 * inlined as their value (no surrounding markup).
 */
export function serializeSlottedPrompt(segments: Segment[]): string {
  return segments
    .map((seg) => {
      if (seg.type === 'text') return seg.value
      const { slot } = seg
      // Cashtag style if it still looks like one (unchanged uppercase)
      if (slot.cashtag && /^[A-Z][A-Z0-9]{0,9}$/.test(slot.value)) {
        return `$${slot.value}`
      }
      return slot.value
    })
    .join('')
}

/**
 * Replace the value at a specific slot id, keeping the rest of the
 * structure intact. Returns a new array — segments are immutable from
 * React's perspective.
 */
export function setSlotValue(segments: Segment[], slotId: string, nextValue: string): Segment[] {
  return segments.map((seg) => {
    if (seg.type !== 'slot' || seg.slot.id !== slotId) return seg
    return { type: 'slot', slot: { ...seg.slot, value: nextValue } }
  })
}

// ─── Hardcoded enum slot options ────────────────────────────────────
// These don't need a DB hit — small, stable lists. Token lookups DO go
// through /api/tokens/search since the universe is huge and changes.

export const CHAIN_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'ethereum', label: 'Ethereum' },
  { value: 'solana', label: 'Solana' },
  { value: 'base', label: 'Base' },
  { value: 'arbitrum', label: 'Arbitrum' },
  { value: 'polygon', label: 'Polygon' },
  { value: 'bsc', label: 'BNB Chain' },
  { value: 'avalanche', label: 'Avalanche' },
  { value: 'optimism', label: 'Optimism' },
]

export const TIMEFRAME_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '1h', label: '1 hour' },
  { value: '6h', label: '6 hours' },
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
]

/** Display label for a slot kind, shown in the picker header. */
export const SLOT_KIND_LABELS: Record<SlotKind, string> = {
  token: 'Token',
  chain: 'Chain',
  timeframe: 'Timeframe',
  wallet: 'Wallet',
  address: 'Contract address',
  number: 'Number',
  text: 'Text',
}

/** Tailwind color per kind so each slot type is visually distinct. */
export const SLOT_KIND_COLORS: Record<SlotKind, string> = {
  token: 'border-cyan-400/40 bg-cyan-400/15 text-cyan-200 hover:bg-cyan-400/25',
  chain: 'border-emerald-400/40 bg-emerald-400/15 text-emerald-200 hover:bg-emerald-400/25',
  timeframe: 'border-purple-400/40 bg-purple-400/15 text-purple-200 hover:bg-purple-400/25',
  wallet: 'border-amber-400/40 bg-amber-400/15 text-amber-200 hover:bg-amber-400/25',
  address: 'border-amber-400/40 bg-amber-400/15 text-amber-200 hover:bg-amber-400/25',
  number: 'border-pink-400/40 bg-pink-400/15 text-pink-200 hover:bg-pink-400/25',
  text: 'border-white/30 bg-white/10 text-white/85 hover:bg-white/15',
}

'use client'

/**
 * TemplateCard — streamlined card with hover effects and clear action CTAs.
 *
 * Two modes:
 *   - Structured (template has skillName) → click opens inline config form.
 *   - Free-text (template.freeTextOnly) → click loads slotted/text prompt.
 */
import { ChevronDown, Play, Sparkles } from 'lucide-react'

import type { WorkflowTemplate } from '@/lib/workflowTemplates'
import { useSkill } from '@/lib/hooks/useSkills'
import { TemplateForm } from './TemplateForm'

interface Props {
  template: WorkflowTemplate
  expanded: boolean
  dimmed: boolean
  userCredits?: number
  onToggle: () => void
  /** Called when the user clicks a free-text card — fills the parent textarea. */
  onFillFreeText: (prompt: string) => void
  /** Called when the structured form submits. */
  onSubmit: (envelope: string) => Promise<void> | void
}

const CATEGORY_ACCENT: Record<string, { text: string; bg: string; border: string }> = {
  research: {
    text: 'text-cyan-300',
    bg: 'bg-cyan-400/[0.06]',
    border: 'border-cyan-400/20',
  },
  'on-chain': {
    text: 'text-emerald-300',
    bg: 'bg-emerald-400/[0.06]',
    border: 'border-emerald-400/20',
  },
  execution: {
    text: 'text-amber-300',
    bg: 'bg-amber-400/[0.06]',
    border: 'border-amber-400/20',
  },
  analysis: {
    text: 'text-purple-300',
    bg: 'bg-purple-400/[0.06]',
    border: 'border-purple-400/20',
  },
}

export function TemplateCard({
  template,
  expanded,
  dimmed,
  userCredits,
  onToggle,
  onFillFreeText,
  onSubmit,
}: Props) {
  const isStructured = !!template.skillName && !template.freeTextOnly
  const skill = useSkill(template.skillName)

  // Cost preview = primary skill + each followup × cost_credits
  const primaryCost = (skill?.manifest?.cost_credits as number) ?? 8
  const followupCount = template.followupSkills?.length ?? 0
  const totalCost = isStructured ? primaryCost + followupCount * primaryCost : primaryCost
  const insufficient =
    isStructured && userCredits !== undefined && userCredits < totalCost

  const handleClick = () => {
    if (isStructured) {
      onToggle()
    } else {
      onFillFreeText(template.prompt)
    }
  }

  const accent = CATEGORY_ACCENT[template.category] ?? CATEGORY_ACCENT.research

  return (
    <div
      className={`transition-all duration-200 ${
        dimmed ? 'pointer-events-none opacity-20 blur-[1px]' : 'opacity-100'
      }`}
    >
      <div
        className={`gw-card-hover flex h-full flex-col overflow-hidden rounded-xl border transition-all ${accent.border} bg-[var(--giga-panel)]/80 hover:border-[var(--giga-accent)]/30 hover:bg-[var(--giga-panel)]`}
      >
        <button
          type="button"
          onClick={handleClick}
          className="flex w-full flex-1 cursor-pointer flex-col text-left"
        >
          {/* Top row: emoji + category badge + cost */}
          <div className="flex items-start justify-between px-4 pt-4 pb-2">
            <div className="flex items-center gap-3">
              <span className="text-2xl leading-none sm:text-3xl">{template.emoji}</span>
              <span className={`rounded-md ${accent.bg} px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${accent.text}`}>
                {template.category === 'execution' ? 'trading' : template.category}
              </span>
            </div>
            {isStructured ? (
              <span
                className={`rounded-md px-2 py-0.5 font-mono text-[11px] font-semibold ${
                  insufficient
                    ? 'bg-red-400/10 text-red-300'
                    : 'bg-[var(--giga-accent)]/10 text-[var(--giga-accent)]'
                }`}
              >
                {totalCost} cr
              </span>
            ) : (
              <span className="rounded-md bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/40">
                free-text
              </span>
            )}
          </div>

          {/* Title + desc */}
          <div className="flex flex-1 flex-col px-4 pb-3">
            <h3 className="mb-1 text-base font-semibold leading-tight text-white sm:text-lg">
              {template.title}
            </h3>
            <p className="line-clamp-2 text-xs leading-relaxed text-white/50 sm:text-sm">
              {template.desc}
            </p>
          </div>

          {/* Skills chips */}
          <div className="flex flex-wrap items-center gap-1 px-4 pb-3">
            {template.uses.slice(0, 3).map((s) => (
              <span
                key={s}
                className="rounded border border-white/[0.06] bg-white/[0.03] px-2 py-0.5 font-mono text-[10px] text-white/40"
              >
                {s}
              </span>
            ))}
          </div>

          {/* Footer CTA */}
          <div className="mt-auto border-t border-white/[0.06] px-4 py-2.5">
            {isStructured ? (
              <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-[var(--giga-accent)]">
                <ChevronDown className="h-3.5 w-3.5" />
                Configure & Run
              </div>
            ) : (
              <div className="flex items-center justify-center gap-1.5 text-xs text-white/45 transition group-hover:text-white/65">
                <Sparkles className="h-3.5 w-3.5" />
                Use as prompt
              </div>
            )}
          </div>
        </button>
      </div>
    </div>
  )
}

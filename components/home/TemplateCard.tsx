'use client'

/**
 * TemplateCard — pixel card with inline expand-to-form.
 *
 * Layout (collapsed):
 *   ┌─ research · 8 cr ─────────────┐
 *   │             🛡                │
 *   │         Safe or Rug?          │
 *   │  Token risk check with…       │
 *   │                               │
 *   │  crypto-scanner · 1 chain     │
 *   │  ─────────────────────────    │
 *   │       ▼ Configure             │
 *   └───────────────────────────────┘
 *
 * Two modes:
 *   - Structured (template has skillName) → click expands inline into a
 *     form rendered from the skill's input_schema. Submit posts a
 *     [INTENT=...] envelope to the brain.
 *   - Free-text (template.freeTextOnly) → click loads the prompt into the
 *     parent textarea, like the original behavior.
 */
import { ChevronDown, Sparkles } from 'lucide-react'

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

const CATEGORY_LABEL: Record<string, string> = {
  research: 'Research',
  'on-chain': 'On-chain',
  execution: 'Execution',
  analysis: 'Analysis',
  synthesis: 'Synthesis',
  notification: 'Notification',
}

const CATEGORY_ACCENT: Record<string, string> = {
  research: 'text-cyan-300/85',
  'on-chain': 'text-emerald-300/85',
  execution: 'text-amber-300/85',
  analysis: 'text-purple-300/85',
  synthesis: 'text-violet-300/85',
  notification: 'text-pink-300/85',
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

  const catLabel = CATEGORY_LABEL[template.category] ?? template.category
  const catAccent = CATEGORY_ACCENT[template.category] ?? 'text-white/60'

  return (
    <div
      className={`group transition-opacity ${
        dimmed ? 'pointer-events-none opacity-25' : 'opacity-100'
      } ${expanded ? 'col-span-2 sm:col-span-3 lg:col-span-4' : ''}`}
    >
      <div
        className={`flex h-full flex-col border-2 bg-[var(--giga-panel)] transition ${
          expanded
            ? 'border-[var(--giga-accent)] shadow-[6px_6px_0_0_#000]'
            : 'border-black hover:border-[var(--giga-accent)]/60'
        }`}
      >
        <button
          type="button"
          onClick={handleClick}
          className="flex w-full flex-1 cursor-pointer flex-col text-left"
        >
          {/* Header bar: category · cost */}
          <div className="flex items-center justify-between border-b-2 border-black bg-[var(--giga-sidebar)] px-3 py-2 text-xs uppercase tracking-wider">
            <span className={`font-medium ${catAccent}`}>{catLabel}</span>
            {isStructured ? (
              <span
                className={`font-mono ${
                  insufficient ? 'text-red-300' : 'text-[var(--giga-accent)]'
                }`}
              >
                {totalCost} cr
              </span>
            ) : (
              <span className="text-white/45">free-text</span>
            )}
          </div>

          {/* Body */}
          <div className="flex flex-1 flex-col items-center px-4 pt-5 pb-3 text-center">
            <div className="mb-3 text-4xl leading-none sm:text-5xl">{template.emoji}</div>
            <h3 className="mb-2 text-lg font-bold text-white sm:text-xl">
              {template.title}
            </h3>
            <p className="mb-3 line-clamp-2 text-sm leading-snug text-white/65">
              {template.desc}
            </p>

            {/* Skills used row */}
            <div className="mt-auto mb-3 flex flex-wrap items-center justify-center gap-1.5">
              {template.uses.slice(0, 3).map((s) => (
                <span
                  key={s}
                  className="border border-white/10 bg-black/30 px-2 py-0.5 font-mono text-[11px] text-white/65"
                >
                  {s}
                </span>
              ))}
            </div>
          </div>

          {/* Footer affordance — same row position across all cards */}
          <div className="border-t border-white/10 px-3 py-2.5">
            {isStructured ? (
              <div className="flex items-center justify-center gap-1.5 text-xs font-medium uppercase tracking-wider text-[var(--giga-accent)]">
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${
                    expanded ? 'rotate-180' : ''
                  }`}
                />
                {expanded ? 'Collapse' : 'Configure'}
              </div>
            ) : (
              <div className="flex items-center justify-center gap-1.5 text-xs uppercase tracking-wider text-white/55 group-hover:text-white/75">
                <Sparkles className="h-3.5 w-3.5" />
                Use as prompt
              </div>
            )}
          </div>
        </button>

        {expanded && isStructured && (
          <TemplateForm
            template={template}
            userCredits={userCredits}
            onSubmit={onSubmit}
            onCancel={onToggle}
          />
        )}
      </div>
    </div>
  )
}

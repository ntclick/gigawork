'use client'

/**
 * TemplateForm — auto-generated form from a skill's input_schema (JSON Schema).
 *
 * Renders one input per property:
 *   - string + enum     → <select>
 *   - string (otherwise)→ <input type=text>
 *   - integer/number    → <input type=number> (with min/max if specified)
 *   - boolean           → <input type=checkbox>
 *   - array of enum     → multi-checkbox row
 *
 * Submits a structured envelope (see workflowTemplates.buildEnvelope) — brain
 * recognizes the [INTENT=...] header and skips prose-parsing.
 */
import { useMemo, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'

import {
  buildEnvelope,
  type WorkflowTemplate,
} from '@/lib/workflowTemplates'
import { useSkill } from '@/lib/hooks/useSkills'

interface Props {
  template: WorkflowTemplate
  onSubmit: (envelope: string) => Promise<void> | void
  onCancel: () => void
  userCredits?: number
}

export function TemplateForm({ template, onSubmit, onCancel, userCredits }: Props) {
  const skill = useSkill(template.skillName)
  const props = skill?.manifest?.input_schema?.properties ?? {}
  const required = new Set(skill?.manifest?.input_schema?.required ?? [])

  const initial = useMemo(() => {
    const out: Record<string, unknown> = {}
    for (const [k, p] of Object.entries(props)) {
      if (template.defaults && k in template.defaults) {
        out[k] = template.defaults[k]
      } else if (p.default !== undefined) {
        out[k] = p.default
      } else if (p.type === 'boolean') {
        out[k] = false
      } else if (p.type === 'integer' || p.type === 'number') {
        out[k] = p.minimum ?? 0
      } else if (p.type === 'array') {
        out[k] = []
      } else {
        out[k] = ''
      }
    }
    return out
  }, [props, template.defaults])

  const [values, setValues] = useState<Record<string, unknown>>(initial)
  const [userNote, setUserNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Cost preview = primary skill + each followup
  const primaryCost = (skill?.manifest?.cost_credits as number) ?? 8
  const followupCount = template.followupSkills?.length ?? 0
  const totalCost = primaryCost + followupCount * primaryCost
  const insufficient = userCredits !== undefined && userCredits < totalCost

  const setField = (k: string, v: unknown) => {
    setValues((prev) => ({ ...prev, [k]: v }))
  }

  const validate = (): string | null => {
    for (const k of Object.keys(props)) {
      if (required.has(k)) {
        const v = values[k]
        if (v === undefined || v === null || v === '' ||
            (Array.isArray(v) && v.length === 0)) {
          return `Missing required field "${k}"`
        }
      }
    }
    return null
  }

  const handleSubmit = async () => {
    const v = validate()
    if (v) {
      setError(v)
      return
    }
    if (!template.skillName) {
      setError('Template has no skill mapped')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const envelope = buildEnvelope({
        templateId: template.id,
        skillName: template.skillName,
        followupSkills: template.followupSkills,
        params: values,
        userNote,
      })
      await onSubmit(envelope)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submit failed')
      setSubmitting(false)
    }
  }

  if (!skill) {
    return (
      <div className="flex items-center justify-center px-4 py-6 text-sm text-white/55">
        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Loading schema…
      </div>
    )
  }

  return (
    <div className="border-t-2 border-black bg-[var(--giga-dark)]/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-[var(--giga-accent)]">
          ▸ {skill.manifest.display_name ?? template.skillName}
        </div>
        {skill.agentTokenId && (
          <div className="font-mono text-xs text-white/55">
            8004 #{skill.agentTokenId}
          </div>
        )}
      </div>

      <div className="space-y-3">
        {Object.entries(props).map(([key, prop]) => (
          <FormField
            key={key}
            name={key}
            prop={prop}
            value={values[key]}
            required={required.has(key)}
            onChange={(v) => setField(key, v)}
          />
        ))}

        <div>
          <label className="mb-1 block text-xs uppercase tracking-wider text-white/55">
            Extra note <span className="text-white/35">(optional)</span>
          </label>
          <textarea
            value={userNote}
            onChange={(e) => setUserNote(e.target.value)}
            placeholder="e.g., should I DCA into this, or focus on holder distribution"
            rows={2}
            className="w-full resize-none border-2 border-black bg-[#1f1f33] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-[var(--giga-accent)] focus:outline-none"
          />
        </div>
      </div>

      {/* Cost preview + balance */}
      <div className="mt-4 flex items-center justify-between border-2 border-cyan-400/30 bg-cyan-400/[0.05] px-3 py-2 text-xs">
        <span className="text-white/65">
          Cost ~{totalCost} credit
          {followupCount > 0 && (
            <span className="ml-1 text-white/40">
              ({1 + followupCount} skills × {primaryCost} cr)
            </span>
          )}
        </span>
        <span className={insufficient ? 'text-red-300' : 'text-cyan-200/85'}>
          Balance: <span className="font-mono">{userCredits ?? '—'}</span> cr
          {insufficient && ' ⚠'}
        </span>
      </div>

      {error && (
        <div className="mt-3 border-2 border-red-400/40 bg-red-500/10 px-2 py-1.5 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <button
          onClick={onCancel}
          disabled={submitting}
          className="border-2 border-black bg-[#1f1f33] px-4 py-2 text-sm text-white/75 hover:bg-[#27273f] disabled:opacity-40"
        >
          ✗ Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={submitting || insufficient}
          className="flex flex-1 items-center justify-center gap-1.5 border-2 border-black bg-[var(--giga-accent)] px-4 py-2 text-sm font-bold text-black hover:bg-yellow-300 disabled:opacity-40"
        >
          {submitting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {insufficient
            ? `Need ${totalCost - (userCredits ?? 0)} more cr · top up`
            : submitting
            ? 'Sending…'
            : `▶ Run (${totalCost} cr)`}
        </button>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// Field renderer
// ════════════════════════════════════════════════════════════════
function FormField({
  name,
  prop,
  value,
  required,
  onChange,
}: {
  name: string
  prop: import('@/lib/hooks/useSkills').SkillInputProperty
  value: unknown
  required: boolean
  onChange: (v: unknown) => void
}) {
  const label = name.replaceAll('_', ' ')
  const labelEl = (
    <label className="mb-1 block text-xs uppercase tracking-wider text-white/55">
      {label} {required && <span className="text-amber-300">*</span>}
      {prop.description && (
        <span className="ml-1 normal-case text-white/35">— {prop.description}</span>
      )}
    </label>
  )

  // String + enum → select
  if (prop.type === 'string' && Array.isArray(prop.enum)) {
    return (
      <div>
        {labelEl}
        <select
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className="w-full border-2 border-black bg-[#1f1f33] px-3 py-2 text-sm text-white focus:border-[var(--giga-accent)] focus:outline-none"
        >
          {prop.enum.map((opt) => (
            <option key={String(opt)} value={String(opt)}>
              {String(opt)}
            </option>
          ))}
        </select>
      </div>
    )
  }

  // Boolean → checkbox
  if (prop.type === 'boolean') {
    return (
      <div className="flex items-center gap-2">
        <input
          id={`f-${name}`}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 accent-[var(--giga-accent)]"
        />
        <label htmlFor={`f-${name}`} className="text-sm text-white/75">
          {label} {required && <span className="text-amber-300">*</span>}
          {prop.description && (
            <span className="ml-1 text-xs text-white/45">— {prop.description}</span>
          )}
        </label>
      </div>
    )
  }

  // Number / integer
  if (prop.type === 'integer' || prop.type === 'number') {
    return (
      <div>
        {labelEl}
        <input
          type="number"
          value={Number(value ?? 0)}
          min={prop.minimum}
          max={prop.maximum}
          step={prop.type === 'integer' ? 1 : 'any'}
          onChange={(e) => {
            const v = prop.type === 'integer' ? parseInt(e.target.value, 10) : parseFloat(e.target.value)
            onChange(Number.isFinite(v) ? v : 0)
          }}
          className="w-full border-2 border-black bg-[#1f1f33] px-3 py-2 text-sm text-white focus:border-[var(--giga-accent)] focus:outline-none"
        />
      </div>
    )
  }

  // Array of enum strings → multi-checkbox
  if (prop.type === 'array' && prop.items?.enum) {
    const arr = Array.isArray(value) ? (value as string[]) : []
    return (
      <div>
        {labelEl}
        <div className="flex flex-wrap gap-2">
          {prop.items.enum.map((opt) => {
            const o = String(opt)
            const checked = arr.includes(o)
            return (
              <button
                key={o}
                type="button"
                onClick={() => {
                  if (checked) onChange(arr.filter((x) => x !== o))
                  else onChange([...arr, o])
                }}
                className={`border-2 border-black px-2 py-1 text-xs transition ${
                  checked
                    ? 'bg-[var(--giga-accent)] text-black'
                    : 'bg-[#1f1f33] text-white/65 hover:bg-[#27273f]'
                }`}
              >
                {checked ? '✓ ' : ''}
                {o}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // Default — string text input
  return (
    <div>
      {labelEl}
      <input
        type="text"
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        placeholder={prop.pattern ? `pattern: ${prop.pattern}` : ''}
        className="w-full border-2 border-black bg-[#1f1f33] px-3 py-2 font-mono text-sm text-white placeholder:text-white/30 focus:border-[var(--giga-accent)] focus:outline-none"
      />
    </div>
  )
}

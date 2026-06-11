'use client'

/**
 * useSkills — fetch the registered skill list once and cache in module scope.
 *
 * The skill registry is small (11 rows, ~10KB) and rarely changes — we
 * fetch once on first mount and let the rest of the app reuse the data.
 * For TemplateForm this gives access to `skill.manifest.input_schema`
 * without prop-drilling.
 */
import { useEffect, useState } from 'react'

export interface SkillInputSchema {
  type?: string
  required?: string[]
  properties?: Record<string, SkillInputProperty>
}

export interface SkillInputProperty {
  type?: 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object'
  description?: string
  enum?: unknown[]
  default?: unknown
  minLength?: number
  minimum?: number
  maximum?: number
  pattern?: string
  format?: string
  items?: { type?: string; enum?: unknown[] }
}

export interface SkillManifest {
  schema_version?: string
  display_name?: string
  description?: string
  category?: string
  cost_credits?: number
  best_for_keywords?: string[]
  input_schema?: SkillInputSchema
  provider_apis?: string[]
  on_chain?: { ipfs_uri?: string; tx_hash?: string; owner?: string }
  [key: string]: unknown
}

export interface Skill {
  id: string
  name: string
  manifest: SkillManifest
  endpoint: string
  agentTokenId: string | null
  agentTxHash: string | null
  livenessStatus?: string | null
  livenessCapacity?: number | null
  livenessUptime30d?: number | null
  consecutiveJobFailures?: number | null
  lastHeartbeatAt?: string | null
}

let CACHE: Skill[] | null = null
const SUBSCRIBERS = new Set<(s: Skill[]) => void>()
let INFLIGHT: Promise<Skill[]> | null = null

async function fetchSkills(): Promise<Skill[]> {
  if (CACHE) return CACHE
  if (INFLIGHT) return INFLIGHT
  INFLIGHT = fetch('/api/skills', { cache: 'no-store' })
    .then((r) => r.json())
    .then((j: { skills: Skill[] }) => {
      CACHE = j.skills ?? []
      INFLIGHT = null
      SUBSCRIBERS.forEach((cb) => cb(CACHE!))
      return CACHE
    })
    .catch(() => {
      INFLIGHT = null
      return []
    })
  return INFLIGHT
}

export function useSkills(): { skills: Skill[]; loading: boolean } {
  const [skills, setSkills] = useState<Skill[] | null>(CACHE)

  useEffect(() => {
    if (CACHE) {
      return
    }
    SUBSCRIBERS.add(setSkills)
    fetchSkills()
    return () => {
      SUBSCRIBERS.delete(setSkills)
    }
  }, [])

  return { skills: skills ?? [], loading: skills === null }
}

export function useSkill(name: string | undefined): Skill | null {
  const { skills } = useSkills()
  if (!name) return null
  return skills.find((s) => s.name === name) ?? null
}

import { type DraftGraph, isTrigger, type TriggerType } from './graph'

/**
 * Trigger matching rules shared by the engine (apps/api automation.core) and the builder's
 * publish-time overlap warning (docs/AUTOMATION_ENGINE.md → Matching). Pure functions only.
 */

export type KeywordConfig = {
  keywords: string[]
  match: 'EXACT' | 'WHOLE_WORD' | 'CONTAINS' | 'STARTS_WITH'
  caseSensitive: boolean
}

export const normalizeReplyText = (text: string, caseSensitive = false) =>
  (caseSensitive ? text : text.toLocaleLowerCase())
    .normalize('NFKC')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()

/** Keyword match per `trigger.keyword` config. Whitespace-trimmed; case-insensitive by default. */
export function keywordMatches(config: KeywordConfig, text: string): boolean {
  const norm = (s: string) => normalizeReplyText(s, config.caseSensitive)
  const t = norm(text)
  if (!t) return false
  return config.keywords.some((k) => {
    const kw = norm(k)
    if (!kw) return false
    if (config.match === 'WHOLE_WORD') return ` ${t} `.includes(` ${kw} `)
    if (config.match === 'EXACT') return t === kw
    if (config.match === 'STARTS_WITH') return t.startsWith(kw)
    return t.includes(kw)
  })
}

const time = (d: Date | string) => (typeof d === 'string' ? Date.parse(d) : d.getTime())

/** AE2: priority ASC, then created_at ASC, then id ASC. */
export function orderPlan<T extends { priority: number; createdAt: Date | string; id: string }>(
  flows: readonly T[],
): T[] {
  return [...flows].sort(
    (a, b) =>
      a.priority - b.priority ||
      time(a.createdAt) - time(b.createdAt) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
}

type TriggerNode = { type: TriggerType; config: Record<string, unknown> }
export type OverlapFlow = {
  id: string
  name: string
  priority: number
  createdAt: string
  /** The flow's trigger node (draft for the one being published, live version for the others). */
  trigger: TriggerNode
}
export type Overlap = {
  flow: OverlapFlow
  /**
   * `ORDER`: both run for the same event, one after another (AE3); `first` names the one that
   * runs first. `SUPPRESSES`: a keyword match stops "Message received" flows for that message.
   */
  kind: 'ORDER' | 'SUPPRESSES'
  first: string
  /** For SUPPRESSES: the flow that does not run when the keyword matches. */
  suppressed?: string
}

export const triggerOf = (g: Pick<DraftGraph, 'nodes'>): TriggerNode | undefined =>
  g.nodes.find((n) => isTrigger(n.type)) as TriggerNode | undefined

const kw = (c: Record<string, unknown>): KeywordConfig => ({
  keywords: Array.isArray(c.keywords) ? (c.keywords as string[]) : [],
  match: (c.match as KeywordConfig['match']) ?? 'EXACT',
  caseSensitive: c.caseSensitive === true,
})

/**
 * Could one message start both keyword flows? Each flow's keywords are tried as messages against
 * the other's rule with the engine's `keywordMatches`, so EXACT/CONTAINS/STARTS_WITH and case
 * follow the runtime exactly for those messages.
 */
function keywordsOverlap(a: KeywordConfig, b: KeywordConfig): boolean {
  return (
    a.keywords.some((k) => keywordMatches(a, k) && keywordMatches(b, k)) ||
    b.keywords.some((k) => keywordMatches(a, k) && keywordMatches(b, k))
  )
}

const phones = (c: Record<string, unknown>) =>
  Array.isArray(c.phoneNumberIds) ? (c.phoneNumberIds as string[]) : []
const sources = (c: Record<string, unknown>) =>
  Array.isArray(c.sources) ? (c.sources as string[]) : []
const intersects = (a: string[], b: string[]) =>
  !a.length || !b.length || a.some((x) => b.includes(x))

/**
 * Live flows that can match the same event as `current` (no engine change: the same rules as
 * the trigger processor). Webhook flows never overlap: each has its own URL.
 */
export function findOverlaps(current: OverlapFlow, others: readonly OverlapFlow[]): Overlap[] {
  const out: Overlap[] = []
  const a = current.trigger
  for (const other of others) {
    if (other.id === current.id) continue
    const b = other.trigger
    const first = () => orderPlan([current, other])[0]!.id
    if (a.type === 'trigger.keyword' && b.type === 'trigger.keyword') {
      if (keywordsOverlap(kw(a.config), kw(b.config)))
        out.push({ flow: other, kind: 'ORDER', first: first() })
    } else if (a.type === 'trigger.keyword' && b.type === 'trigger.message_received') {
      out.push({ flow: other, kind: 'SUPPRESSES', first: current.id, suppressed: other.id })
    } else if (a.type === 'trigger.message_received' && b.type === 'trigger.keyword') {
      out.push({ flow: other, kind: 'SUPPRESSES', first: other.id, suppressed: current.id })
    } else if (a.type === 'trigger.message_received' && b.type === 'trigger.message_received') {
      if (intersects(phones(a.config), phones(b.config)))
        out.push({ flow: other, kind: 'ORDER', first: first() })
    } else if (a.type === 'trigger.contact_created' && b.type === 'trigger.contact_created') {
      if (intersects(sources(a.config), sources(b.config)))
        out.push({ flow: other, kind: 'ORDER', first: first() })
    }
  }
  return out
}

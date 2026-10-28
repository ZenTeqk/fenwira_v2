import { describe, expect, it } from 'vitest'
import {
  AI_ASSISTANT_TEMPLATE,
  type DraftGraph,
  findOverlaps,
  FLOW_TEMPLATE_CATEGORIES,
  FLOW_TEMPLATES,
  type FlowSetupStep,
  flowSetupDone,
  type OverlapFlow,
  validateFlowGraph,
} from '../src'

const UUID = '0192f6a0-0000-7000-8000-000000000001'

/** What an owner enters for each checklist item. */
function fill(g: DraftGraph, step: FlowSetupStep): DraftGraph {
  const patch: Record<FlowSetupStep['kind'], Record<string, unknown>> = {
    template: { templateId: UUID, variables: { body: ['{{contact.firstName}}'] } },
    keywords: { keywords: ['price'] },
    tags: { tagIds: [UUID] },
    condition_tag: { tagIds: [UUID] },
    message: { text: 'Thanks!' },
    agent: { mode: 'ROUND_ROBIN' },
    delay: { amount: 1, unit: 'DAYS' },
    webhook_phone: { contactPhonePath: 'customer.phone' },
    webhook_url: { url: 'https://crm.example.com/hooks/fenwira' },
  }
  return {
    ...g,
    nodes: g.nodes.map((n) =>
      n.id === step.nodeId ? { ...n, config: { ...n.config, ...patch[step.kind] } } : n,
    ),
  }
}

describe('automation template registry', () => {
  it.each(FLOW_TEMPLATES.map((t) => [t.id, t] as const))(
    '%s passes the shared validator once its setup is filled',
    (_, t) => {
      const blank = t.graph()
      const filled = t.setup.reduce(fill, blank)
      expect(validateFlowGraph(filled)).toEqual({ valid: true, errors: [] })
      for (const step of t.setup) {
        expect(
          blank.nodes.some((n) => n.id === step.nodeId),
          step.nodeId,
        ).toBe(true)
        expect(
          flowSetupDone(
            step,
            filled.nodes.find((n) => n.id === step.nodeId),
          ),
        ).toBe(true)
      }
    },
  )

  it('templates that need a template or tag choice are not publishable as they come', () => {
    const needsChoice = (s: FlowSetupStep) => ['template', 'tags', 'condition_tag'].includes(s.kind)
    for (const t of FLOW_TEMPLATES.filter((x) => x.setup.some(needsChoice)))
      expect(validateFlowGraph(t.graph()).valid, t.id).toBe(false)
  })

  it('has unique ids, known categories, and fresh graphs on every call', () => {
    expect(new Set(FLOW_TEMPLATES.map((t) => t.id)).size).toBe(FLOW_TEMPLATES.length)
    const known = new Set(FLOW_TEMPLATE_CATEGORIES.map((c) => c.id))
    for (const t of FLOW_TEMPLATES) for (const c of t.categories) expect(known.has(c)).toBe(true)
    const t = FLOW_TEMPLATES[0]!
    t.graph().nodes[0]!.config.mutated = true
    expect(t.graph().nodes[0]!.config.mutated).toBeUndefined()
  })

  it('reuses the AI Assistant managed flow under AI', () => {
    const ai = FLOW_TEMPLATES.find((t) => t.id === 'ai-assistant')!
    expect(ai.categories).toEqual(['AI'])
    expect(ai.requires).toEqual(['AI_ASSISTANT'])
    expect(ai.graph().nodes).toEqual(AI_ASSISTANT_TEMPLATE.nodes)
    expect(ai.graph().edges).toEqual(AI_ASSISTANT_TEMPLATE.edges)
  })
})

describe('overlap detection', () => {
  const flow = (
    id: string,
    trigger: OverlapFlow['trigger'],
    priority = 100,
    createdAt = '2026-10-01T00:00:00.000Z',
  ): OverlapFlow => ({ id, name: id, priority, createdAt, trigger })
  const kw = (keywords: string[], match = 'EXACT') =>
    ({ type: 'trigger.keyword', config: { keywords, match, caseSensitive: false } }) as const
  const msg = (config: Record<string, unknown> = {}) =>
    ({ type: 'trigger.message_received', config }) as const

  it('keyword flows overlap when one message can match both, ordered by priority', () => {
    const me = flow('me', kw(['price']), 100)
    const contains = flow('other', kw(['price list'], 'CONTAINS'), 10)
    // "price list" contains-matches nothing of mine; my EXACT "price" is not contained in it either.
    expect(findOverlaps(me, [contains])).toEqual([])
    const broad = flow('broad', kw(['pri'], 'STARTS_WITH'), 10)
    expect(findOverlaps(me, [broad])).toEqual([{ flow: broad, kind: 'ORDER', first: 'broad' }])
    const same = flow('same', kw(['PRICE']), 200)
    expect(findOverlaps(me, [same])).toEqual([{ flow: same, kind: 'ORDER', first: 'me' }])
    expect(findOverlaps(me, [flow('menu', kw(['menu']))])).toEqual([])
  })

  it('ties on priority go to the older flow (AE2)', () => {
    const me = flow('me', msg(), 100, '2026-10-02T00:00:00.000Z')
    const old = flow('old', msg(), 100, '2026-10-01T00:00:00.000Z')
    expect(findOverlaps(me, [old])[0]!.first).toBe('old')
  })

  it('a keyword wins over Message received, whichever side is being published', () => {
    const keyword = flow('keyword', kw(['price']))
    const any = flow('any', msg(), 1)
    expect(findOverlaps(keyword, [any])).toEqual([
      { flow: any, kind: 'SUPPRESSES', first: 'keyword', suppressed: 'any' },
    ])
    expect(findOverlaps(any, [keyword])).toEqual([
      { flow: keyword, kind: 'SUPPRESSES', first: 'keyword', suppressed: 'any' },
    ])
  })

  it('respects phone numbers and contact sources; webhooks never overlap', () => {
    const a = flow('a', msg({ phoneNumberIds: ['p1'] }))
    expect(findOverlaps(a, [flow('b', msg({ phoneNumberIds: ['p2'] }))])).toEqual([])
    expect(findOverlaps(a, [flow('c', msg())])).toHaveLength(1)
    const imports = flow('i', { type: 'trigger.contact_created', config: { sources: ['IMPORT'] } })
    const manual = flow('m', { type: 'trigger.contact_created', config: { sources: ['MANUAL'] } })
    expect(findOverlaps(imports, [manual])).toEqual([])
    const hook = { type: 'trigger.webhook', config: { contactPhonePath: 'phone' } } as const
    expect(findOverlaps(flow('w1', hook), [flow('w2', hook)])).toEqual([])
    expect(findOverlaps(a, [a])).toEqual([])
  })
})

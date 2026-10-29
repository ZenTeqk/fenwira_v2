import { describe, expect, it } from 'vitest'
import {
  draftGraphSchema,
  evaluateExpression,
  expressionPaths,
  type FlowGraph,
  NODE_TYPES,
  outputsOf,
  validateFlowGraph,
} from '../src'

const T = '00000000-0000-4000-8000-000000000001'

/** keyword trigger → has_tag? → yes: send text → end; no: end */
function graph(): FlowGraph {
  return {
    nodes: [
      {
        id: 't',
        type: 'trigger.keyword',
        config: { keywords: ['hi'], match: 'EXACT', caseSensitive: false },
      },
      { id: 'c', type: 'condition.has_tag', config: { tagIds: [T], match: 'ANY' } },
      { id: 's', type: 'action.send_message', config: { text: 'Hello {{contact.firstName}}' } },
      { id: 'e1', type: 'action.end', config: {} },
      { id: 'e2', type: 'action.end', config: {} },
    ],
    edges: [
      { id: '1', source: 't', target: 'c', sourceHandle: 'next' },
      { id: '2', source: 'c', target: 's', sourceHandle: 'yes' },
      { id: '3', source: 'c', target: 'e2', sourceHandle: 'no' },
      { id: '4', source: 's', target: 'e1', sourceHandle: 'next' },
    ],
    layout: {},
  }
}
const codes = (g: unknown) =>
  validateFlowGraph(g).errors.map((e) => `${e.code}:${e.nodeId ?? e.edgeId ?? ''}`)

describe('validateFlowGraph (publish gate)', () => {
  it('accepts a valid flow', () => {
    expect(validateFlowGraph(graph())).toEqual({ valid: true, errors: [] })
  })

  it('requires exactly one trigger with no incoming edges', () => {
    const g = graph()
    g.nodes = g.nodes.filter((n) => n.id !== 't')
    g.edges = g.edges.filter((e) => e.source !== 't')
    expect(codes(g)).toContain('FLOW_TRIGGER_COUNT:')
    const h = graph()
    h.edges.push({ id: 'x', source: 's', target: 't', sourceHandle: 'error' })
    expect(validateFlowGraph(h).errors).toContainEqual(
      expect.objectContaining({ code: 'FLOW_TRIGGER_COUNT', edgeId: 'x', nodeId: 't' }),
    )
  })

  it('pinpoints unreachable, dangling and branch problems by node', () => {
    const g = graph()
    g.nodes.push({ id: 'lonely', type: 'action.end', config: {} })
    g.edges = g.edges.filter((e) => e.id !== '3' && e.id !== '4')
    const c = codes(g)
    expect(c).toContain('FLOW_UNREACHABLE_NODE:lonely')
    expect(c).toContain('FLOW_UNREACHABLE_NODE:e2')
    expect(c).toContain('FLOW_CONDITION_BRANCHES:c')
    expect(c).toContain('FLOW_DANGLING_NODE:s')
  })

  it('pinpoints invalid node config', () => {
    const g = graph() as unknown as { nodes: Array<{ id: string; config: unknown }> }
    g.nodes[2]!.config = { text: '' }
    expect(codes(g)).toEqual(['FLOW_NODE_CONFIG_INVALID:s'])
  })

  it('rejects edges from handles a node does not have', () => {
    const g = graph()
    g.edges.push({ id: 'bad', source: 'c', target: 'e1', sourceHandle: 'next' })
    expect(codes(g)).toContain('FLOW_EDGE_INVALID:bad')
  })

  it('allows loops only through a delay', () => {
    const g = graph()
    g.edges = g.edges.map((e) => (e.id === '4' ? { ...e, target: 'c' } : e))
    expect(codes(g)).toContain('FLOW_CYCLE_WITHOUT_DELAY:c')
    const h = graph()
    h.nodes.push({ id: 'd', type: 'action.delay', config: { amount: 1, unit: 'MINUTES' } })
    h.edges = h.edges.map((e) => (e.id === '4' ? { ...e, target: 'd' } : e))
    h.edges.push({ id: '5', source: 'd', target: 'c', sourceHandle: 'next' })
    expect(codes(h).filter((c) => c.startsWith('FLOW_CYCLE'))).toEqual([])
  })

  it('refuses unknown expression roots', () => {
    const g = graph()
    ;(g.nodes[2]!.config as { text: string }).text = 'Hi {{process.env.SECRET}}'
    expect(codes(g)).toContain('FLOW_EXPRESSION_INVALID:s')
  })

  it('limits the size', () => {
    const g = graph()
    for (let i = 0; i < 100; i++) g.nodes.push({ id: `x${i}`, type: 'action.end', config: {} })
    expect(codes(g)).toContain('FLOW_TOO_LARGE:')
  })

  it('drafts may hold incomplete configs; the validator names them', () => {
    const draft = draftGraphSchema.parse({
      nodes: [{ id: 't', type: 'trigger.keyword', config: {} }],
      edges: [],
    })
    expect(draft.layout).toEqual({})
    expect(codes(draft)).toEqual(['FLOW_NODE_CONFIG_INVALID:t'])
  })

  it('offers the documented handles per node type', () => {
    expect(NODE_TYPES).toHaveLength(19)
    expect(outputsOf('action.ai_reply')).toEqual(['replied', 'needs_human', 'error'])
    expect(outputsOf('condition.equals')).toEqual(['yes', 'no'])
    expect(outputsOf('action.end')).toEqual([])
    expect(outputsOf('action.webhook')).toEqual(['next', 'error'])
    expect(outputsOf('action.delay')).toEqual(['next'])
  })
})

describe('AI reply step', () => {
  const ai = (edges: Array<[string, string]>) => ({
    nodes: [
      { id: 't', type: 'trigger.message_received', config: {} },
      { id: 'a', type: 'action.ai_reply', config: { mode: 'CONVERSATION' } },
      { id: 'e', type: 'action.end', config: {} },
    ],
    edges: [
      { id: 'e0', source: 't', target: 'a', sourceHandle: 'next' },
      ...edges.map(([h, id]) => ({ id, source: 'a', target: 'e', sourceHandle: h })),
    ],
  })

  it('publishes with all three outputs connected', () => {
    expect(
      validateFlowGraph(
        ai([
          ['replied', 'e1'],
          ['needs_human', 'e2'],
          ['error', 'e3'],
        ]),
      ).valid,
    ).toBe(true)
  })

  it('requires Replied, Needs a human and Error paths', () => {
    const r = validateFlowGraph(ai([['replied', 'e1']]))
    expect(r.errors.filter((e) => e.nodeId === 'a').map((e) => e.message)).toEqual([
      'Connect the Needs a human path (to the next step or an End).',
      'Connect the Error path (to the next step or an End).',
    ])
    expect(validateFlowGraph(ai([['next', 'e1']])).errors.map((e) => e.code)).toContain(
      'FLOW_EDGE_INVALID',
    )
  })
})

describe('expressions', () => {
  const ctx = {
    contact: { name: 'Ada Lovelace', firstName: 'Ada', property: { plan: 'gold', n: 3 } },
    trigger: { message: { text: 'HI' }, webhook: { order: { id: 42, items: [1, 2] } } },
    vars: { crm: { body: { tier: 'vip' } } },
  }

  it('resolves known paths', () => {
    expect(
      evaluateExpression(
        '{{contact.firstName}} {{ contact.property.plan }} {{trigger.webhook.order.id}} {{vars.crm.body.tier}}',
        ctx,
      ),
    ).toBe('Ada gold 42 vip')
  })

  it('renders missing values and unknown roots as empty', () => {
    expect(evaluateExpression('[{{contact.email}}][{{secret.x}}][{{vars.none.a}}]', ctx)).toBe(
      '[][][]',
    )
  })

  it('never executes code or walks prototypes', () => {
    expect(evaluateExpression('{{contact.constructor}}{{contact.__proto__}}', ctx)).toBe('')
    expect(evaluateExpression('{{contact.name.length}}', ctx)).toBe('')
    expect(evaluateExpression('{{ 1 + 1 }}', ctx)).toBe('{{ 1 + 1 }}')
  })

  it('serializes objects as JSON', () => {
    expect(evaluateExpression('{{trigger.webhook.order.items}}', ctx)).toBe('[1,2]')
  })

  it('lists the paths an expression uses', () => {
    expect(expressionPaths('a {{contact.name}} b {{vars.x}}')).toEqual(['contact.name', 'vars.x'])
  })
})

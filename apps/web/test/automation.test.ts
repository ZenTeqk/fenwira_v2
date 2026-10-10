import { type DraftGraph, validateFlowGraph } from '@fenwira/contracts'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/components/session/session-provider', () => ({ useSession: () => ({}) }))
const { addNode, autoLayout, connect, readingOrder, removeNode, summarize } =
  await import('@/lib/automation')

const empty: DraftGraph = { nodes: [], edges: [], layout: {} }

describe('builder graph helpers', () => {
  it('builds a valid flow step by step, connecting each new step to the free output', () => {
    let g = empty
    const t = addNode(g, 'trigger.keyword')
    g = t.graph
    g = { ...g, nodes: g.nodes.map((n) => ({ ...n, config: { ...n.config, keywords: ['hi'] } })) }
    const c = addNode(g, 'condition.exists', t.id)
    g = c.graph
    const yes = addNode(g, 'action.end', c.id) // takes "yes"
    g = yes.graph
    const no = addNode(g, 'action.end', c.id) // then "no"
    g = no.graph
    g = {
      ...g,
      nodes: g.nodes.map((n) =>
        n.id === c.id ? { ...n, config: { subject: '{{contact.email}}' } } : n,
      ),
    }
    expect(g.edges.map((e) => e.sourceHandle).sort()).toEqual(['next', 'no', 'yes'])
    expect(validateFlowGraph(g)).toEqual({ valid: true, errors: [] })
    expect(readingOrder(g).map((n) => n.id)).toEqual([t.id, c.id, yes.id, no.id])
  })

  it('re-connecting an output replaces its edge; removing a node drops its edges', () => {
    let g = addNode(empty, 'trigger.message_received').graph
    const trigger = g.nodes[0]!.id
    const a = addNode(g, 'action.end')
    g = a.graph
    const b = addNode(g, 'action.end')
    g = connect(connect(b.graph, trigger, 'next', a.id), trigger, 'next', b.id)
    expect(g.edges).toEqual([
      { id: `e-${trigger}-next`, source: trigger, target: b.id, sourceHandle: 'next' },
    ])
    expect(removeNode(g, b.id).edges).toEqual([])
    expect(connect(g, trigger, 'next', null).edges).toEqual([])
  })

  it('auto layout only moves nodes, top to bottom', () => {
    let g = addNode(empty, 'trigger.keyword').graph
    g = addNode(g, 'action.end', g.nodes[0]!.id).graph
    const laid = autoLayout(g)
    expect(laid.nodes).toEqual(g.nodes)
    expect(laid.edges).toEqual(g.edges)
    const [top, bottom] = g.nodes.map((n) => laid.layout[n.id]!.y)
    expect(top!).toBeLessThan(bottom!)
  })

  it('summaries describe the step', () => {
    expect(
      summarize({ id: 'x', type: 'trigger.keyword', config: { keywords: ['price', 'menu'] } }),
    ).toBe('When a message is “price”, “menu”')
    expect(summarize({ id: 'x', type: 'action.delay', config: { amount: 2, unit: 'HOURS' } })).toBe(
      '2 hours',
    )
  })
})

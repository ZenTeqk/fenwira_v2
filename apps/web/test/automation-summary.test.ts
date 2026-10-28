import { type DraftGraph, FLOW_TEMPLATES, validateFlowGraph } from '@fenwira/contracts'
import { describe, expect, it, vi } from 'vitest'
import { describeFlow, triggerClause } from '@/lib/automation-summary'

vi.mock('@/components/session/session-provider', () => ({ useSession: () => ({}) }))
const { insertNode, setupChecklist } = await import('@/lib/automation')

const template = (id: string) => FLOW_TEMPLATES.find((t) => t.id === id)!.graph()
const names = {
  tag: (id: string) => ({ t1: 'lead', t2: 'send-failed' })[id],
  template: (id: string) => ({ tpl: 'order_update' })[id],
  member: (id: string) => ({ u1: 'Team A' })[id],
}
const withConfig = (g: DraftGraph, id: string, config: Record<string, unknown>): DraftGraph => ({
  ...g,
  nodes: g.nodes.map((n) => (n.id === id ? { ...n, config: { ...n.config, ...config } } : n)),
})

describe('summary sentence', () => {
  it('reads a linear flow in order with names', () => {
    let g = template('lead-capture')
    g = withConfig(g, 'tag', { tagIds: ['t1'] })
    g = withConfig(g, 'assign', { mode: 'USER', userId: 'u1' })
    expect(describeFlow(g, names)).toBe(
      'When a message contains “price”, add the tag lead, assign to Team A, then send “Thanks [first name]! A teammate will sh…”.',
    )
  })

  it('describes conditions with both branches and error paths', () => {
    let g = template('order-update')
    g = withConfig(g, 'update', { templateId: 'tpl' })
    g = withConfig(g, 'failed', { tagIds: ['t2'] })
    expect(describeFlow(g, names)).toBe(
      'When your system calls the webhook, send the template “order_update” (if it fails, add the tag send-failed).',
    )
    expect(describeFlow(template('follow-up-no-reply'), names)).toBe(
      'When a contact is added by your team, from an import or through the API, send a template, wait 1 day, then if the contact replied in the last day, stop; otherwise send a template.',
    )
  })

  it('covers empty flows, lone triggers and unknown names', () => {
    expect(describeFlow({ nodes: [], edges: [], layout: {} })).toBe(
      'Add a trigger to say when this automation starts.',
    )
    const lone: DraftGraph = {
      nodes: [{ id: 't', type: 'trigger.message_received', config: { onlyNewConversation: true } }],
      edges: [],
      layout: {},
    }
    expect(describeFlow(lone)).toBe(
      'When someone starts a new conversation, … (add the next step).',
    )
    expect(describeFlow(template('welcome-new-contact'))).toBe(
      'When a contact is added, send a template, then add a tag.',
    )
    expect(triggerClause({ type: 'trigger.keyword', config: { keywords: ['hi', 'hello'] } })).toBe(
      'When a message is “hi” or “hello”',
    )
    expect(triggerClause(undefined)).toBe('When the trigger is set')
  })
})

describe('setup checklist and inserting steps', () => {
  it('uses the template steps first and ticks them off as values arrive', () => {
    let g = template('welcome-new-contact')
    const open = setupChecklist(g, validateFlowGraph(g).errors, 'welcome-new-contact')
    expect(open.map((i) => [i.label, i.done])).toEqual([
      ['Pick the welcome template', false],
      ['Choose the tag', false],
    ])
    expect(open[1]!.suggestedTag).toBe('welcomed')
    g = withConfig(g, 'tag', { tagIds: ['0192f6a0-0000-7000-8000-000000000001'] })
    const next = setupChecklist(g, validateFlowGraph(g).errors, 'welcome-new-contact')
    expect(next.map((i) => i.done)).toEqual([false, true])
    // Without the template id, every node that needs input gets a generic item.
    expect(setupChecklist(g, [], null).map((i) => i.label)).toEqual([
      'Pick the approved template',
      'Choose the tag to add',
    ])
  })

  it('a "+" on an edge puts the new step between both ends', () => {
    const g = template('keyword-reply')
    const { graph, id } = insertNode(g, 'condition.has_tag', 'trigger', 'next')
    expect(graph.edges.find((e) => e.source === 'trigger')?.target).toBe(id)
    expect(graph.edges.find((e) => e.source === id)).toMatchObject({
      target: 'reply',
      sourceHandle: 'yes',
    })
    expect(Object.keys(graph.layout).sort()).toEqual([...g.nodes.map((n) => n.id), id].sort())
  })
})

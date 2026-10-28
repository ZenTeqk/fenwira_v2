import { type ApprovedTemplate, type DraftGraph, NODE_TYPES } from '@fenwira/contracts'
import { describe, expect, it } from 'vitest'
import {
  draftToPreview,
  previewParts,
  previewPathTo,
  substitutePreview,
} from '@/lib/automation-preview'

const contact = { name: 'Asha Patel', phone: '+919876543210', properties: { city: 'Mumbai' } }
function one(
  type: DraftGraph['nodes'][number]['type'],
  config: Record<string, unknown> = {},
): DraftGraph {
  return {
    nodes: [
      { id: 'trigger', type: 'trigger.keyword', config: { keywords: ['price'] } },
      { id: 'node', type, config },
    ],
    edges: [{ id: 'edge', source: 'trigger', target: 'node', sourceHandle: 'next' }],
    layout: {},
  }
}
const template: ApprovedTemplate = {
  templateId: 'template',
  versionId: 'version',
  wabaId: 'waba',
  name: 'Order update',
  language: 'en',
  category: 'UTILITY',
  samples: { body: ['Example'] },
  components: {
    header: { format: 'TEXT', text: 'Order {{1}}' },
    body: { text: 'Hello {{1}}, order {{2}}' },
    footer: { text: 'Thank you' },
    buttons: [{ type: 'QUICK_REPLY', text: 'Help' }],
  },
}

describe('client-only draft preview', () => {
  it.each(NODE_TYPES)('renders %s, including incomplete node configs', (type) => {
    const graph = type.startsWith('trigger.')
      ? { nodes: [{ id: 'node', type, config: {} }], edges: [], layout: {} }
      : one(type)
    const before = structuredClone(graph)
    const steps = draftToPreview(graph, { contact })
    expect(steps.find((step) => step.nodeId === 'node')?.text).toBeTruthy()
    expect(graph).toEqual(before)
  })
  it('fills names, phones, properties and incoming text without interpreting HTML', () => {
    const text = substitutePreview(
      '{{contact.name}} / {{contact.firstName}} / {{contact.phone}} / {{contact.properties.city}} / {{trigger.message.text}} / {{contact.email}}',
      contact,
      '<img>',
    )
    expect(text).toBe(
      'Asha Patel / Asha / +919876543210 / Mumbai / <img> / ⟦missing:contact.email⟧',
    )
    expect(previewParts(text).at(-1)).toEqual({ text: '', missing: 'contact.email' })
    expect(previewParts('{{1}}')).toEqual([{ text: '', missing: '1' }])
  })
  it('defaults incoming text to the first keyword and allows an empty edited incoming message', () => {
    expect(draftToPreview(one('action.end'), { contact })[0]?.text).toBe('price')
    expect(draftToPreview(one('action.end'), { contact, incoming: '' })[0]?.text).toBe('')
  })
  it('reuses the complete inbox snapshot with mapped template values and missing-value chips', () => {
    const steps = draftToPreview(
      one('action.send_template', {
        templateId: 'template',
        variables: { header: ['#1042'], body: ['{{contact.firstName}}', '{{contact.order}}'] },
      }),
      { contact, templates: [template] },
    )
    expect(steps[1]?.snapshot).toMatchObject({
      body: 'Hello Asha, order ⟦missing:contact.order⟧',
      header: { type: 'TEXT', text: 'Order #1042' },
      footer: 'Thank you',
      buttons: [{ label: 'Help' }],
    })
    expect(draftToPreview(one('action.send_template'), { contact })[1]).toMatchObject({
      kind: 'warning',
      text: 'Template not set',
    })
  })
  it('renders media, delays, contact updates, tags, assignments, AI and webhook placeholders', () => {
    expect(
      draftToPreview(
        one('action.send_message', { mediaFileId: 'file', caption: 'Hi {{contact.firstName}}' }),
        { contact },
      )[1]?.text,
    ).toBe('Media attachment · Hi Asha')
    expect(
      draftToPreview(one('action.delay', { amount: 1, unit: 'DAYS' }), { contact })[1]?.text,
    ).toBe('1 day later')
    expect(
      draftToPreview(one('action.delay', { amount: 2, unit: 'HOURS' }), { contact })[1]?.text,
    ).toBe('2 hours later')
    expect(
      draftToPreview(one('action.add_tag', { tagIds: ['lead'] }), {
        contact,
        tagName: () => 'lead',
      })[1]?.text,
    ).toBe('Tag added: lead')
    expect(
      draftToPreview(one('action.remove_tag', { tagIds: ['lead'] }), {
        contact,
        tagName: () => 'lead',
      })[1]?.text,
    ).toBe('Tag removed: lead')
    expect(
      draftToPreview(one('action.assign_agent', { mode: 'USER', userId: 'a' }), {
        contact,
        memberName: () => 'Team A',
      })[1]?.text,
    ).toBe('Assigned to Team A')
    expect(draftToPreview(one('action.webhook'), { contact })[1]?.text).toContain(
      'not run in preview',
    )
    expect(draftToPreview(one('action.ai_reply'), { contact })[1]?.text).toContain('preview only')
    const graph = one('action.update_contact', { updates: [{ field: 'name', value: 'New name' }] })
    graph.nodes.push({
      id: 'message',
      type: 'action.send_message',
      config: { text: '{{contact.name}}' },
    })
    graph.edges.push({ id: 'e2', source: 'node', target: 'message', sourceHandle: 'next' })
    expect(draftToPreview(graph, { contact })[2]?.text).toBe('New name')
    expect(contact.name).toBe('Asha Patel')
  })
  it('chooses Yes or No explicitly, explains the choice, and reveals selected branches', () => {
    const graph = one('condition.exists', { subject: '{{contact.email}}' })
    graph.nodes.push(
      { id: 'yes', type: 'action.end', config: {} },
      { id: 'no', type: 'action.end', config: {} },
    )
    graph.edges.push(
      { id: 'yes-edge', source: 'node', target: 'yes', sourceHandle: 'yes' },
      { id: 'no-edge', source: 'node', target: 'no', sourceHandle: 'no' },
    )
    expect(draftToPreview(graph, { contact }).at(-1)?.nodeId).toBe('yes')
    const no = draftToPreview(graph, { contact, paths: { node: 'no' } })
    expect(no.at(-1)?.nodeId).toBe('no')
    expect(no[1]?.reason).toContain('No branch you chose')
    expect(previewPathTo(graph, 'no')).toEqual({ node: 'no' })
  })
  it('shows loops once and truncates after 30 steps, including malformed cycles', () => {
    const loop = one('action.delay', { amount: 1, unit: 'DAYS' })
    loop.nodes.push({ id: 'message', type: 'action.send_message', config: { text: 'Hello' } })
    loop.edges.push(
      { id: 'e2', source: 'node', target: 'message', sourceHandle: 'next' },
      { id: 'e3', source: 'message', target: 'node', sourceHandle: 'next' },
    )
    expect(draftToPreview(loop, { contact }).map((step) => step.text)).toEqual([
      'price',
      '1 day later',
      'Hello',
      'Repeats',
    ])
    const graph = one('action.send_message', { text: 'Hello' })
    for (let i = 0; i < 35; i++) {
      graph.nodes.push({ id: `n${i}`, type: 'action.send_message', config: { text: `${i}` } })
      graph.edges.push({
        id: `e${i}`,
        source: i === 0 ? 'node' : `n${i - 1}`,
        target: `n${i}`,
        sourceHandle: 'next',
      })
    }
    expect(draftToPreview(graph, { contact })).toHaveLength(31)
    expect(draftToPreview(graph, { contact }).at(-1)?.text).toBe('Preview truncated')
  })
  it('reports errors without throwing, ignores orphan nodes, and handles missing triggers', () => {
    expect(draftToPreview({ nodes: [], edges: [], layout: {} }, { contact })).toEqual([])
    const graph = one('action.end')
    graph.nodes.push({ id: 'orphan', type: 'action.end', config: {} })
    expect(previewPathTo(graph, 'orphan')).toBeNull()
    expect(
      draftToPreview(graph, {
        contact,
        issues: [{ code: 'FLOW_NODE_CONFIG_INVALID', nodeId: 'node', message: 'Fix this step' }],
      })[1]?.warnings,
    ).toEqual(['Fix this step'])
  })
})

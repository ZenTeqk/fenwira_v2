import { type DraftGraph } from '@fenwira/contracts'
import { autoLayout } from '@/lib/automation'

/**
 * Starter recipes for common SMB automations (UX_PATTERNS → Automations). A recipe only produces
 * an ordinary draft FlowGraph for the same builder and runtime; there is no second format.
 * Placeholders (keywords, message text) are left for the owner to fill in, and the shared
 * validator flags anything missing before publish.
 */
export type Recipe = {
  id: string
  title: string
  description: string
  /** What the owner still has to set after creating it. */
  todo: string
  graph: () => DraftGraph
}

type N = DraftGraph['nodes'][number]
type E = DraftGraph['edges'][number]

function chain(nodes: N[]): DraftGraph {
  const edges: E[] = nodes.slice(1).map((n, i) => ({
    id: `e${i}`,
    source: nodes[i]!.id,
    target: n.id,
    sourceHandle: 'next',
  }))
  return autoLayout({ nodes, edges, layout: {} })
}

export const RECIPES: Recipe[] = [
  {
    id: 'keyword-reply',
    title: 'Reply to a keyword',
    description: 'When a customer sends a word like “price” or “menu”, reply instantly.',
    todo: 'Set the keywords and write the reply.',
    graph: () =>
      chain([
        {
          id: 'trigger',
          type: 'trigger.keyword',
          config: { keywords: ['price'], match: 'EXACT', caseSensitive: false },
        },
        {
          id: 'reply',
          type: 'action.send_message',
          config: { text: 'Hi {{contact.firstName}}, here are our prices: ' },
        },
        { id: 'end', type: 'action.end', config: {} },
      ]),
  },
  {
    id: 'welcome',
    title: 'Welcome first-time customers',
    description: 'Greet people the first time they message you, and tag them as new.',
    todo: 'Choose the tag and adjust the greeting.',
    graph: () =>
      chain([
        {
          id: 'trigger',
          type: 'trigger.message_received',
          config: { onlyNewConversation: true },
        },
        {
          id: 'greet',
          type: 'action.send_message',
          config: {
            text: 'Hi {{contact.firstName}}, thanks for reaching out! A teammate will reply shortly.',
          },
        },
        { id: 'tag', type: 'action.add_tag', config: { tagIds: [] } },
        { id: 'end', type: 'action.end', config: {} },
      ]),
  },
  {
    id: 'route',
    title: 'Assign new conversations',
    description: 'Hand every new conversation to whoever on the team is online.',
    todo: 'Nothing required; optionally add a greeting before assigning.',
    graph: () =>
      chain([
        {
          id: 'trigger',
          type: 'trigger.message_received',
          config: { onlyNewConversation: true },
        },
        { id: 'assign', type: 'action.assign_agent', config: { mode: 'ROUND_ROBIN' } },
        { id: 'end', type: 'action.end', config: {} },
      ]),
  },
  {
    id: 'follow-up',
    title: 'Follow up later',
    description: 'Reply to a keyword now, then check in again a day later.',
    todo: 'Set the keyword, the two messages and the wait.',
    graph: () =>
      chain([
        {
          id: 'trigger',
          type: 'trigger.keyword',
          config: { keywords: ['demo'], match: 'CONTAINS', caseSensitive: false },
        },
        {
          id: 'reply',
          type: 'action.send_message',
          config: { text: 'Thanks {{contact.firstName}}! We will send the details shortly.' },
        },
        { id: 'wait', type: 'action.delay', config: { amount: 23, unit: 'HOURS' } },
        {
          id: 'check',
          type: 'action.send_message',
          config: { text: 'Hi {{contact.firstName}}, did you get everything you needed?' },
        },
        { id: 'end', type: 'action.end', config: {} },
      ]),
  },
]

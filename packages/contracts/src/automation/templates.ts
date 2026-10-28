import { type REENTRY_POLICIES } from '../api/automation'
import { type DraftGraph, type EdgeHandle, type FlowGraph, type NodeType } from './graph'

/**
 * Automation templates for the "Create automation" gallery (UX_PATTERNS → Automations). Each one
 * is an ordinary flow graph for the same builder, validator and runtime; there is no second
 * format. Values the owner must choose (templates, tags, keywords, teammates) are listed in
 * `setup`, which drives the builder's "Set up your automation" checklist. Adding a template is
 * one entry in FLOW_TEMPLATES.
 */

export const FLOW_TEMPLATE_CATEGORIES = [
  { id: 'POPULAR', label: 'Popular' },
  { id: 'WELCOME', label: 'Welcome & replies' },
  { id: 'LEADS', label: 'Leads' },
  { id: 'ORDERS', label: 'Orders & updates' },
  { id: 'FOLLOW_UPS', label: 'Follow-ups' },
  { id: 'AI', label: 'AI' },
] as const
export type FlowTemplateCategory = (typeof FLOW_TEMPLATE_CATEGORIES)[number]['id']
export type FlowTemplateRequirement = 'APPROVED_TEMPLATE' | 'AI_ASSISTANT'

/** What one checklist item asks for; `flowSetupDone` decides when it is complete. */
export type FlowSetupKind =
  | 'template'
  | 'keywords'
  | 'tags'
  | 'message'
  | 'agent'
  | 'delay'
  | 'webhook_phone'
  | 'condition_tag'
export type FlowSetupStep = {
  nodeId: string
  kind: FlowSetupKind
  label: string
  hint?: string
  /** Tags: the name the template suggests ("welcomed"); the builder offers to create it. */
  suggestedTag?: string
}

export type FlowTemplate = {
  id: string
  title: string
  description: string
  categories: FlowTemplateCategory[]
  /** Node type whose icon represents the template on its card. */
  icon: NodeType
  requires: FlowTemplateRequirement[]
  reentryPolicy: (typeof REENTRY_POLICIES)[number]
  setup: FlowSetupStep[]
  /** A fresh copy each call; `layout` is empty and filled by the builder's auto-layout. */
  graph: () => DraftGraph
}

type N = DraftGraph['nodes'][number]
const node = (id: string, type: NodeType, config: Record<string, unknown> = {}): N => ({
  id,
  type,
  config,
})
const edge = (source: string, target: string, sourceHandle: EdgeHandle = 'next') => ({
  id: `e-${source}-${sourceHandle}`,
  source,
  target,
  sourceHandle,
})
const graph = (nodes: N[], edges: Array<ReturnType<typeof edge>>): DraftGraph => ({
  nodes,
  edges,
  layout: {},
})
/** a → b → c through `next`. */
const chain = (...ids: string[]) => ids.slice(1).map((id, i) => edge(ids[i]!, id))
const end = (id = 'end') => node(id, 'action.end')

/**
 * The AI Assistant's managed flow (docs/AI_ASSISTANT.md → Managed flow): Message received → AI
 * reply (conversation) → End on every path. The AI Assistant page publishes it; the gallery
 * offers the same graph.
 */
export const AI_ASSISTANT_TEMPLATE: FlowGraph = {
  nodes: [
    { id: 'trigger', type: 'trigger.message_received', config: { onlyNewConversation: false } },
    { id: 'ai', type: 'action.ai_reply', config: { mode: 'CONVERSATION' } },
    { id: 'end-replied', type: 'action.end', config: {} },
    { id: 'end-human', type: 'action.end', config: {} },
    { id: 'end-error', type: 'action.end', config: {} },
  ],
  edges: [
    { id: 'e-trigger', source: 'trigger', target: 'ai', sourceHandle: 'next' },
    { id: 'e-replied', source: 'ai', target: 'end-replied', sourceHandle: 'replied' },
    { id: 'e-human', source: 'ai', target: 'end-human', sourceHandle: 'needs_human' },
    { id: 'e-error', source: 'ai', target: 'end-error', sourceHandle: 'error' },
  ],
  layout: {
    trigger: { x: 0, y: 0 },
    ai: { x: 0, y: 160 },
    'end-replied': { x: -280, y: 340 },
    'end-human': { x: 0, y: 340 },
    'end-error': { x: 280, y: 340 },
  },
}

const TEMPLATE_STEP = (nodeId: string, label = 'Pick the approved template'): FlowSetupStep => ({
  nodeId,
  kind: 'template',
  label,
  hint: 'Only templates Meta approved can start a conversation.',
})

export const FLOW_TEMPLATES: FlowTemplate[] = [
  {
    id: 'welcome-new-contact',
    title: 'Welcome new contact',
    description: 'Send a welcome template to every new contact and tag them as welcomed.',
    categories: ['POPULAR', 'WELCOME'],
    icon: 'trigger.contact_created',
    requires: ['APPROVED_TEMPLATE'],
    reentryPolicy: 'ONCE_PER_CONTACT',
    setup: [
      TEMPLATE_STEP('welcome', 'Pick the welcome template'),
      { nodeId: 'tag', kind: 'tags', label: 'Choose the tag', suggestedTag: 'welcomed' },
    ],
    graph: () =>
      graph(
        [
          node('trigger', 'trigger.contact_created'),
          node('welcome', 'action.send_template', { templateId: '', variables: { body: [] } }),
          node('tag', 'action.add_tag', { tagIds: [] }),
          end(),
        ],
        chain('trigger', 'welcome', 'tag', 'end'),
      ),
  },
  {
    id: 'out-of-hours',
    title: 'Out-of-hours reply',
    description: 'Tell customers your opening hours when a contact tagged out-of-hours writes in.',
    categories: ['WELCOME'],
    icon: 'condition.has_tag',
    requires: [],
    reentryPolicy: 'AFTER_COMPLETION',
    setup: [
      {
        nodeId: 'check',
        kind: 'condition_tag',
        label: 'Choose the out-of-hours tag',
        hint: 'Fenwira has no business-hours condition yet, so this checks a tag your team or another automation adds.',
        suggestedTag: 'out-of-hours',
      },
      { nodeId: 'hours', kind: 'message', label: 'Write your opening hours' },
    ],
    graph: () =>
      graph(
        [
          node('trigger', 'trigger.message_received', { onlyNewConversation: false }),
          node('check', 'condition.has_tag', { tagIds: [], match: 'ANY' }),
          node('hours', 'action.send_message', {
            text: 'Hi {{contact.firstName}}, we are closed right now. We are open Monday to Saturday, 9 am to 6 pm, and will reply as soon as we are back.',
          }),
          end(),
          end('end-open'),
        ],
        [
          edge('trigger', 'check'),
          edge('check', 'hours', 'yes'),
          edge('check', 'end-open', 'no'),
          edge('hours', 'end'),
        ],
      ),
  },
  {
    id: 'keyword-reply',
    title: 'Keyword reply',
    description: 'Reply instantly when a customer sends a word like “menu” or “hours”.',
    categories: ['POPULAR', 'WELCOME'],
    icon: 'trigger.keyword',
    requires: [],
    reentryPolicy: 'ALWAYS',
    setup: [
      { nodeId: 'trigger', kind: 'keywords', label: 'Set the keywords' },
      { nodeId: 'reply', kind: 'message', label: 'Write the reply' },
    ],
    graph: () =>
      graph(
        [
          node('trigger', 'trigger.keyword', {
            keywords: ['menu'],
            match: 'EXACT',
            caseSensitive: false,
          }),
          node('reply', 'action.send_message', {
            text: 'Hi {{contact.firstName}}, here is our menu: ',
          }),
          end(),
        ],
        chain('trigger', 'reply', 'end'),
      ),
  },
  {
    id: 'lead-capture',
    title: 'Lead capture and assign',
    description: 'When someone asks about price, tag them as a lead and hand them to your team.',
    categories: ['POPULAR', 'LEADS'],
    icon: 'action.assign_agent',
    requires: [],
    reentryPolicy: 'AFTER_COMPLETION',
    setup: [
      { nodeId: 'trigger', kind: 'keywords', label: 'Set the keywords' },
      { nodeId: 'tag', kind: 'tags', label: 'Choose the lead tag', suggestedTag: 'lead' },
      { nodeId: 'assign', kind: 'agent', label: 'Choose who gets the lead' },
      { nodeId: 'reply', kind: 'message', label: 'Write the reply' },
    ],
    graph: () =>
      graph(
        [
          node('trigger', 'trigger.keyword', {
            keywords: ['price'],
            match: 'CONTAINS',
            caseSensitive: false,
          }),
          node('tag', 'action.add_tag', { tagIds: [] }),
          node('assign', 'action.assign_agent', { mode: 'ROUND_ROBIN' }),
          node('reply', 'action.send_message', {
            text: 'Thanks {{contact.firstName}}! A teammate will share prices with you shortly.',
          }),
          end(),
        ],
        chain('trigger', 'tag', 'assign', 'reply', 'end'),
      ),
  },
  {
    id: 'order-update',
    title: 'Order update from your system',
    description: 'Your shop or ERP calls a webhook; Fenwira sends the order update template.',
    categories: ['ORDERS'],
    icon: 'trigger.webhook',
    requires: ['APPROVED_TEMPLATE'],
    reentryPolicy: 'ALWAYS',
    setup: [
      { nodeId: 'trigger', kind: 'webhook_phone', label: 'Say where the phone number is' },
      {
        ...TEMPLATE_STEP('update', 'Pick the order update template'),
        hint: 'Map values from your system, for example {{trigger.webhook.order.id}}.',
      },
      {
        nodeId: 'failed',
        kind: 'tags',
        label: 'Choose the tag for failed sends',
        suggestedTag: 'send-failed',
      },
    ],
    graph: () =>
      graph(
        [
          node('trigger', 'trigger.webhook', {
            contactPhonePath: 'customer.phone',
            requireSignature: true,
          }),
          node('update', 'action.send_template', { templateId: '', variables: { body: [] } }),
          end(),
          node('failed', 'action.add_tag', { tagIds: [] }),
          end('end-failed'),
        ],
        [
          edge('trigger', 'update'),
          edge('update', 'end'),
          edge('update', 'failed', 'error'),
          edge('failed', 'end-failed'),
        ],
      ),
  },
  {
    id: 'follow-up-no-reply',
    title: 'Follow-up after no reply',
    description: 'Message new contacts, wait a day, and follow up only if they have not replied.',
    categories: ['FOLLOW_UPS'],
    icon: 'action.delay',
    requires: ['APPROVED_TEMPLATE'],
    reentryPolicy: 'ONCE_PER_CONTACT',
    setup: [
      TEMPLATE_STEP('first', 'Pick the first template'),
      { nodeId: 'wait', kind: 'delay', label: 'Choose how long to wait' },
      TEMPLATE_STEP('again', 'Pick the follow-up template'),
    ],
    graph: () =>
      graph(
        [
          // Contacts added by your team, an import or the API (inbound contacts already wrote).
          node('trigger', 'trigger.contact_created', { sources: ['MANUAL', 'IMPORT', 'API'] }),
          node('first', 'action.send_template', { templateId: '', variables: { body: [] } }),
          node('wait', 'action.delay', { amount: 1, unit: 'DAYS' }),
          // "Replied?" = the contact wrote to you in the last day (the existing contact-field check).
          node('replied', 'condition.contact_property', {
            key: 'lastInboundAt',
            operator: 'IN_LAST_DAYS',
            value: 1,
          }),
          end('end-replied'),
          node('again', 'action.send_template', { templateId: '', variables: { body: [] } }),
          end(),
        ],
        [
          ...chain('trigger', 'first', 'wait', 'replied'),
          edge('replied', 'end-replied', 'yes'),
          edge('replied', 'again', 'no'),
          edge('again', 'end'),
        ],
      ),
  },
  {
    id: 'ai-assistant',
    title: 'AI assistant',
    description: 'Answer customers from your knowledge and hand over to a person when needed.',
    categories: ['AI'],
    icon: 'action.ai_reply',
    requires: ['AI_ASSISTANT'],
    reentryPolicy: 'AFTER_COMPLETION',
    setup: [],
    graph: () => structuredClone({ ...AI_ASSISTANT_TEMPLATE, layout: {} }),
  },
]

const list = (v: unknown) => (Array.isArray(v) ? v : [])
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** Whether the owner has completed a checklist item (validation still has the final say). */
export function flowSetupDone(step: FlowSetupStep, node: { config: unknown } | undefined) {
  if (!node) return false
  const c = (node.config ?? {}) as Record<string, unknown>
  switch (step.kind) {
    case 'template':
      return text(c.templateId).length > 0
    case 'keywords':
      return list(c.keywords).some((k) => text(k))
    case 'tags':
    case 'condition_tag':
      return list(c.tagIds).length > 0
    case 'message':
      return text(c.text).length > 0 || text(c.mediaFileId).length > 0
    case 'agent':
      return c.mode === 'ROUND_ROBIN' || text(c.userId).length > 0
    case 'delay':
      return typeof c.amount === 'number' && c.amount >= 1 && !!c.unit
    case 'webhook_phone':
      return text(c.contactPhonePath).length > 0
  }
}

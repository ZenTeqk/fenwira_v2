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
  { id: 'CAMPAIGNS', label: 'Campaigns' },
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
  | 'webhook_url'
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
  // ---------------------------------------------------------------------------------------------
  // Advanced samples: several branches, waits and checks on one canvas. Same nodes and runtime.
  // ---------------------------------------------------------------------------------------------
  {
    id: 'new-customer-journey',
    title: 'New customer journey',
    description:
      'Welcome every new contact, follow up after a day, hand engaged people to your team and tag the quiet ones.',
    categories: ['POPULAR', 'WELCOME'],
    icon: 'trigger.contact_created',
    requires: ['APPROVED_TEMPLATE'],
    reentryPolicy: 'ONCE_PER_CONTACT',
    setup: [
      TEMPLATE_STEP('welcome', 'Pick the welcome template'),
      {
        nodeId: 'tag-new',
        kind: 'tags',
        label: 'Choose the new-customer tag',
        suggestedTag: 'new-customer',
      },
      { nodeId: 'wait-1', kind: 'delay', label: 'Choose the first wait' },
      { nodeId: 'assign', kind: 'agent', label: 'Choose who talks to engaged customers' },
      TEMPLATE_STEP('nudge', 'Pick the follow-up template'),
      { nodeId: 'wait-2', kind: 'delay', label: 'Choose the second wait' },
      {
        nodeId: 'tag-quiet',
        kind: 'tags',
        label: 'Choose the tag for quiet contacts',
        suggestedTag: 'not-engaged',
      },
      {
        nodeId: 'tag-failed',
        kind: 'tags',
        label: 'Choose the tag for failed sends',
        suggestedTag: 'send-failed',
      },
    ],
    graph: () =>
      graph(
        [
          node('trigger', 'trigger.contact_created'),
          node('welcome', 'action.send_template', {
            templateId: '',
            variables: { body: ['{{contact.firstName}}'] },
          }),
          node('tag-failed', 'action.add_tag', { tagIds: [] }),
          end('end-failed'),
          node('tag-new', 'action.add_tag', { tagIds: [] }),
          node('wait-1', 'action.delay', { amount: 1, unit: 'DAYS' }),
          node('replied-1', 'condition.contact_property', {
            key: 'lastInboundAt',
            operator: 'IN_LAST_DAYS',
            value: 1,
          }),
          node('assign', 'action.assign_agent', { mode: 'ROUND_ROBIN' }),
          end('end-engaged'),
          node('nudge', 'action.send_template', {
            templateId: '',
            variables: { body: ['{{contact.firstName}}'] },
          }),
          node('wait-2', 'action.delay', { amount: 3, unit: 'DAYS' }),
          node('replied-2', 'condition.contact_property', {
            key: 'lastInboundAt',
            operator: 'IN_LAST_DAYS',
            value: 3,
          }),
          node('tag-quiet', 'action.add_tag', { tagIds: [] }),
          end(),
        ],
        [
          edge('trigger', 'welcome'),
          edge('welcome', 'tag-new'),
          edge('welcome', 'tag-failed', 'error'),
          edge('tag-failed', 'end-failed'),
          ...chain('tag-new', 'wait-1', 'replied-1'),
          edge('replied-1', 'assign', 'yes'),
          edge('assign', 'end-engaged'),
          edge('replied-1', 'nudge', 'no'),
          ...chain('nudge', 'wait-2', 'replied-2'),
          edge('replied-2', 'assign', 'yes'),
          edge('replied-2', 'tag-quiet', 'no'),
          edge('tag-quiet', 'end'),
        ],
      ),
  },
  {
    id: 'template-button-router',
    title: 'Template button replies',
    description:
      'Route the quick-reply buttons of your template: “Interested” goes to sales, “Call me” books a call, “Stop” opts out politely.',
    categories: ['POPULAR', 'CAMPAIGNS', 'LEADS'],
    icon: 'condition.equals',
    requires: [],
    reentryPolicy: 'ALWAYS',
    setup: [
      {
        nodeId: 'trigger',
        kind: 'keywords',
        label: 'Match your template’s button texts',
        hint: 'Use the exact quick-reply button labels of your approved template.',
      },
      {
        nodeId: 'tag-hot',
        kind: 'tags',
        label: 'Choose the interested tag',
        suggestedTag: 'hot-lead',
      },
      { nodeId: 'assign-sales', kind: 'agent', label: 'Choose who gets interested customers' },
      {
        nodeId: 'tag-call',
        kind: 'tags',
        label: 'Choose the call-back tag',
        suggestedTag: 'call-back',
      },
      {
        nodeId: 'tag-stop',
        kind: 'tags',
        label: 'Choose the not-interested tag',
        suggestedTag: 'not-interested',
      },
    ],
    graph: () =>
      graph(
        [
          node('trigger', 'trigger.keyword', {
            keywords: ['Interested', 'Call me', 'Stop'],
            match: 'EXACT',
            caseSensitive: false,
          }),
          node('is-interested', 'condition.equals', {
            subject: '{{trigger.message.text}}',
            value: 'Interested',
            caseSensitive: false,
          }),
          node('tag-hot', 'action.add_tag', { tagIds: [] }),
          node('assign-sales', 'action.assign_agent', { mode: 'ROUND_ROBIN' }),
          node('reply-hot', 'action.send_message', {
            text: 'Great, {{contact.firstName}}! A teammate will message you in a few minutes with the details.',
          }),
          end('end-hot'),
          node('is-call', 'condition.equals', {
            subject: '{{trigger.message.text}}',
            value: 'Call me',
            caseSensitive: false,
          }),
          node('tag-call', 'action.add_tag', { tagIds: [] }),
          node('reply-call', 'action.send_message', {
            text: 'Sure! What time suits you for a call today? Reply with a time and we will call {{contact.phone}}.',
          }),
          end('end-call'),
          node('tag-stop', 'action.add_tag', { tagIds: [] }),
          node('reply-stop', 'action.send_message', {
            text: 'No problem, {{contact.firstName}}. We will not send you more offers. Reply anytime if you need us.',
          }),
          end(),
        ],
        [
          edge('trigger', 'is-interested'),
          edge('is-interested', 'tag-hot', 'yes'),
          ...chain('tag-hot', 'assign-sales', 'reply-hot', 'end-hot'),
          edge('is-interested', 'is-call', 'no'),
          edge('is-call', 'tag-call', 'yes'),
          ...chain('tag-call', 'reply-call', 'end-call'),
          edge('is-call', 'tag-stop', 'no'),
          ...chain('tag-stop', 'reply-stop', 'end'),
        ],
      ),
  },
  {
    id: 'campaign-response-booking',
    title: 'Campaign reply to booking',
    description:
      'When customers answer your campaign with “Book now”, confirm with a template, save their reply, and bring in a teammate if they have not booked two hours later.',
    categories: ['CAMPAIGNS', 'FOLLOW_UPS'],
    icon: 'trigger.keyword',
    requires: ['APPROVED_TEMPLATE'],
    reentryPolicy: 'AFTER_COMPLETION',
    setup: [
      {
        nodeId: 'trigger',
        kind: 'keywords',
        label: 'Match the campaign button or reply',
        hint: 'For example the “Book now” quick-reply button of your campaign template.',
      },
      {
        nodeId: 'tag-responded',
        kind: 'tags',
        label: 'Choose the responder tag',
        suggestedTag: 'campaign-responder',
      },
      TEMPLATE_STEP('confirm', 'Pick the booking link template'),
      { nodeId: 'wait', kind: 'delay', label: 'Choose how long to wait' },
      {
        nodeId: 'booked',
        kind: 'condition_tag',
        label: 'Choose the booked tag',
        hint: 'Your team or your booking system (through the API) adds it once the booking is done.',
        suggestedTag: 'booked',
      },
      { nodeId: 'assign', kind: 'agent', label: 'Choose who helps unfinished bookings' },
    ],
    graph: () =>
      graph(
        [
          node('trigger', 'trigger.keyword', {
            keywords: ['Book now', 'Yes'],
            match: 'EXACT',
            caseSensitive: false,
          }),
          node('tag-responded', 'action.add_tag', { tagIds: [] }),
          node('save', 'action.update_contact', {
            updates: [{ field: 'property.campaign_response', value: '{{trigger.message.text}}' }],
          }),
          node('confirm', 'action.send_template', {
            templateId: '',
            variables: { body: ['{{contact.firstName}}'] },
          }),
          node('wait', 'action.delay', { amount: 2, unit: 'HOURS' }),
          node('booked', 'condition.has_tag', { tagIds: [], match: 'ANY' }),
          end('end-booked'),
          node('assign', 'action.assign_agent', { mode: 'ROUND_ROBIN' }),
          node('help', 'action.send_message', {
            text: 'Hi {{contact.firstName}}, need a hand finishing your booking? A teammate is here to help.',
          }),
          end(),
        ],
        [
          ...chain('trigger', 'tag-responded', 'save', 'confirm', 'wait', 'booked'),
          // A failed template send goes straight to a person.
          edge('confirm', 'assign', 'error'),
          edge('booked', 'end-booked', 'yes'),
          edge('booked', 'assign', 'no'),
          ...chain('assign', 'help', 'end'),
        ],
      ),
  },
  {
    id: 'order-lifecycle',
    title: 'Order lifecycle updates',
    description:
      'One webhook from your shop: confirmed, shipped and delivered orders each get their template, and delivered orders get a review request two days later.',
    categories: ['ORDERS'],
    icon: 'trigger.webhook',
    requires: ['APPROVED_TEMPLATE'],
    reentryPolicy: 'ALWAYS',
    setup: [
      {
        nodeId: 'trigger',
        kind: 'webhook_phone',
        label: 'Say where the phone number is',
        hint: 'Your system posts {"customer": {"phone": …}, "status": "confirmed" | "shipped" | "delivered", "order": {…}}.',
      },
      TEMPLATE_STEP('confirmed', 'Pick the order confirmed template'),
      {
        nodeId: 'tag-customer',
        kind: 'tags',
        label: 'Choose the customer tag',
        suggestedTag: 'customer',
      },
      TEMPLATE_STEP('shipped', 'Pick the order shipped template'),
      TEMPLATE_STEP('delivered', 'Pick the order delivered template'),
      { nodeId: 'wait-review', kind: 'delay', label: 'Choose when to ask for a review' },
      TEMPLATE_STEP('review', 'Pick the review request template'),
    ],
    graph: () =>
      graph(
        [
          node('trigger', 'trigger.webhook', {
            contactPhonePath: 'customer.phone',
            requireSignature: true,
          }),
          node('is-confirmed', 'condition.equals', {
            subject: '{{trigger.webhook.status}}',
            value: 'confirmed',
            caseSensitive: false,
          }),
          node('confirmed', 'action.send_template', {
            templateId: '',
            variables: { body: ['{{contact.firstName}}', '{{trigger.webhook.order.id}}'] },
          }),
          node('save-order', 'action.update_contact', {
            updates: [{ field: 'property.last_order_id', value: '{{trigger.webhook.order.id}}' }],
          }),
          node('tag-customer', 'action.add_tag', { tagIds: [] }),
          end('end-confirmed'),
          node('is-shipped', 'condition.equals', {
            subject: '{{trigger.webhook.status}}',
            value: 'shipped',
            caseSensitive: false,
          }),
          node('shipped', 'action.send_template', {
            templateId: '',
            variables: {
              body: ['{{trigger.webhook.order.id}}', '{{trigger.webhook.order.tracking_url}}'],
            },
          }),
          end('end-shipped'),
          node('is-delivered', 'condition.equals', {
            subject: '{{trigger.webhook.status}}',
            value: 'delivered',
            caseSensitive: false,
          }),
          node('delivered', 'action.send_template', {
            templateId: '',
            variables: { body: ['{{contact.firstName}}'] },
          }),
          node('wait-review', 'action.delay', { amount: 2, unit: 'DAYS' }),
          node('review', 'action.send_template', {
            templateId: '',
            variables: { body: ['{{contact.firstName}}'] },
          }),
          end('end-delivered'),
          end('end-other'),
        ],
        [
          edge('trigger', 'is-confirmed'),
          edge('is-confirmed', 'confirmed', 'yes'),
          ...chain('confirmed', 'save-order', 'tag-customer', 'end-confirmed'),
          edge('is-confirmed', 'is-shipped', 'no'),
          edge('is-shipped', 'shipped', 'yes'),
          edge('shipped', 'end-shipped'),
          edge('is-shipped', 'is-delivered', 'no'),
          edge('is-delivered', 'delivered', 'yes'),
          ...chain('delivered', 'wait-review', 'review', 'end-delivered'),
          edge('is-delivered', 'end-other', 'no'),
        ],
      ),
  },
  {
    id: 'abandoned-cart-recovery',
    title: 'Abandoned cart recovery',
    description:
      'Your shop reports an abandoned cart; Fenwira reminds the customer after an hour and sends an offer the next day, skipping anyone who already bought.',
    categories: ['ORDERS', 'FOLLOW_UPS'],
    icon: 'action.delay',
    requires: ['APPROVED_TEMPLATE'],
    reentryPolicy: 'AFTER_COMPLETION',
    setup: [
      { nodeId: 'trigger', kind: 'webhook_phone', label: 'Say where the phone number is' },
      { nodeId: 'wait-1', kind: 'delay', label: 'Choose when to send the reminder' },
      {
        nodeId: 'bought-1',
        kind: 'condition_tag',
        label: 'Choose the tag that means “already bought”',
        hint: 'For example the customer tag added by the Order lifecycle automation.',
        suggestedTag: 'customer',
      },
      {
        ...TEMPLATE_STEP('reminder', 'Pick the cart reminder template'),
        hint: 'Map values from your shop, for example {{trigger.webhook.cart.url}}.',
      },
      { nodeId: 'wait-2', kind: 'delay', label: 'Choose when to send the offer' },
      {
        nodeId: 'bought-2',
        kind: 'condition_tag',
        label: 'Choose the “already bought” tag again',
        suggestedTag: 'customer',
      },
      TEMPLATE_STEP('offer', 'Pick the offer template'),
      {
        nodeId: 'tag-lost',
        kind: 'tags',
        label: 'Choose the tag for unrecovered carts',
        suggestedTag: 'cart-abandoned',
      },
    ],
    graph: () =>
      graph(
        [
          node('trigger', 'trigger.webhook', {
            contactPhonePath: 'customer.phone',
            requireSignature: true,
          }),
          node('wait-1', 'action.delay', { amount: 1, unit: 'HOURS' }),
          node('bought-1', 'condition.has_tag', { tagIds: [], match: 'ANY' }),
          end('end-bought'),
          node('reminder', 'action.send_template', {
            templateId: '',
            variables: { body: ['{{contact.firstName}}', '{{trigger.webhook.cart.url}}'] },
          }),
          node('wait-2', 'action.delay', { amount: 1, unit: 'DAYS' }),
          node('bought-2', 'condition.has_tag', { tagIds: [], match: 'ANY' }),
          end('end-bought-later'),
          node('offer', 'action.send_template', {
            templateId: '',
            variables: { body: ['{{contact.firstName}}'] },
          }),
          node('tag-lost', 'action.add_tag', { tagIds: [] }),
          end(),
          end('end-failed'),
        ],
        [
          ...chain('trigger', 'wait-1', 'bought-1'),
          edge('bought-1', 'end-bought', 'yes'),
          edge('bought-1', 'reminder', 'no'),
          edge('reminder', 'end-failed', 'error'),
          ...chain('reminder', 'wait-2', 'bought-2'),
          edge('bought-2', 'end-bought-later', 'yes'),
          edge('bought-2', 'offer', 'no'),
          ...chain('offer', 'tag-lost', 'end'),
        ],
      ),
  },
  {
    id: 'crm-lead-sync',
    title: 'Send new leads to your CRM',
    description:
      'Post every new contact to your CRM, save the CRM id on the contact, and tag anything that did not sync so your team can check it.',
    categories: ['LEADS'],
    icon: 'action.webhook',
    requires: [],
    reentryPolicy: 'ONCE_PER_CONTACT',
    setup: [
      {
        nodeId: 'crm',
        kind: 'webhook_url',
        label: 'Enter your CRM’s webhook URL',
        hint: 'It should answer with JSON such as {"id": "…"}.',
      },
      {
        nodeId: 'tag-failed',
        kind: 'tags',
        label: 'Choose the tag for leads that did not sync',
        suggestedTag: 'crm-sync-failed',
      },
    ],
    graph: () =>
      graph(
        [
          node('trigger', 'trigger.contact_created'),
          node('crm', 'action.webhook', {
            method: 'POST',
            url: '',
            body: '{"name": "{{contact.name}}", "phone": "{{contact.phone}}", "email": "{{contact.email}}"}',
            timeoutMs: 5000,
            saveResponseAs: 'crm',
          }),
          node('has-id', 'condition.exists', { subject: '{{vars.crm.id}}' }),
          node('save-id', 'action.update_contact', {
            updates: [{ field: 'property.crm_id', value: '{{vars.crm.id}}' }],
          }),
          end(),
          node('tag-failed', 'action.add_tag', { tagIds: [] }),
          end('end-failed'),
        ],
        [
          edge('trigger', 'crm'),
          edge('crm', 'has-id'),
          edge('crm', 'tag-failed', 'error'),
          edge('has-id', 'save-id', 'yes'),
          edge('has-id', 'tag-failed', 'no'),
          ...chain('save-id', 'end'),
          edge('tag-failed', 'end-failed'),
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
    case 'webhook_url':
      return /^https:\/\/\S+\.\S+/.test(text(c.url))
  }
}

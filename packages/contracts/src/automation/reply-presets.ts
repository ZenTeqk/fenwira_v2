import { type DraftGraph, type NodeType } from './graph'
import { replyStudioSettingsSchema } from './reply-studio'
export const REPLY_PRESETS = [
  {
    id: 'welcome',
    title: 'Welcome reply',
    kind: 'AUTO_REPLY',
    help: 'Greet the first message in a new conversation. Respect a per-contact cooldown.',
  },
  {
    id: 'out-of-hours',
    title: 'Out-of-hours reply',
    kind: 'AUTO_REPLY',
    help: 'Use your workspace schedule and holidays to reply when you are closed.',
  },
  {
    id: 'keyword',
    title: 'Keyword reply',
    kind: 'AUTO_REPLY',
    help: 'Answer common questions such as location, opening times or delivery.',
  },
  {
    id: 'faq',
    title: 'FAQ menu',
    kind: 'BOT_FLOW',
    help: 'Offer a short menu, then connect customers with your team.',
  },
  {
    id: 'product-enquiry',
    title: 'Product Enquiry',
    kind: 'BOT_FLOW',
    help: 'Collect product preferences, quantity and required date, review the enquiry, then hand it to a salesperson.',
  },
] as const
export type ReplyPresetId = (typeof REPLY_PRESETS)[number]['id'] | 'blank'
export function replyPreset(
  id: ReplyPresetId,
  kind: 'AUTO_REPLY' | 'BOT_FLOW' = 'BOT_FLOW',
): DraftGraph {
  const nodes: DraftGraph['nodes'] = []
  const edges: DraftGraph['edges'] = []
  const add = (id: string, type: NodeType, config: Record<string, unknown> = {}) => {
    nodes.push({ id, type, config })
    return id
  }
  const link = (
    source: string,
    target: string,
    sourceHandle: 'next' | 'yes' | 'no' | 'error' = 'next',
  ) => edges.push({ id: `${source}-${sourceHandle}`, source, target, sourceHandle })
  const message = (id: string, text: string) => add(id, 'action.send_message', { text })
  const question = (id: string, text: string, answerType = 'TEXT') =>
    add(id, 'action.question', { text, field: id, answerType, maxRetries: 2 })
  const options = (id: string, text: string, labels: string[]) =>
    add(id, 'action.options', {
      text,
      field: id,
      presentation: 'BUTTONS',
      options: labels.map((label) => ({ value: label, label })),
      maxRetries: 2,
    })
  const preset = REPLY_PRESETS.find((p) => p.id === id)
  const settings = replyStudioSettingsSchema.parse({ kind: preset?.kind ?? kind })
  add(
    'start',
    id === 'welcome' || id === 'out-of-hours' ? 'trigger.message_received' : 'trigger.keyword',
    id === 'welcome'
      ? { onlyNewConversation: true, cooldownHours: 24 }
      : id === 'out-of-hours'
        ? { onlyNewConversation: false, businessHours: 'ANY' }
        : {
            keywords:
              id === 'keyword'
                ? ['location', 'address']
                : id === 'product-enquiry'
                  ? ['enquiry', 'inquiry', 'product']
                  : ['help', 'faq'],
            match: 'EXACT',
            caseSensitive: false,
          },
  )
  add('end', 'action.end')
  if (settings.kind === 'AUTO_REPLY') {
    message(
      'reply',
      id === 'blank'
        ? ''
        : id === 'welcome'
          ? 'Welcome! How can our team help with your enquiry today?'
          : id === 'keyword'
            ? 'You can find us at [enter your address].'
            : 'Thanks for your enquiry. Our team is currently closed and will reply when we reopen.',
    )
    if (id === 'out-of-hours') {
      add('hours', 'condition.business_hours')
      link('start', 'hours')
      link('hours', 'end', 'yes')
      link('hours', 'reply', 'no')
    } else link('start', 'reply')
    link('reply', 'end')
  } else {
    message('greeting', 'Welcome! Let us help with your enquiry.')
    link('start', 'greeting')
    add('handover', 'action.handover', {
      tagIds: [],
      note:
        id === 'product-enquiry'
          ? 'Product enquiry\nCategory: {{vars.category}}\nProduct: {{vars.product}}\nPreference: {{vars.preference}}\nQuantity: {{vars.quantity}}\nRequired date: {{vars.required_date}}\nConfirmation: {{vars.confirm}}\nPlease confirm availability, price and commitment with the customer.'
          : 'Customer enquiry: {{vars.topic}}',
    })
    link('handover', 'end')
    message(
      'acknowledgement',
      'Thank you. Your enquiry has been sent to our team. A salesperson will confirm availability, price and any commitment with you.',
    )
    link('acknowledgement', 'handover')
    // One fallback path: the runtime offers a human at most once per conversation per 24h.
    if (id === 'product-enquiry') {
      options('category', 'Which category interests you?', ['Clothing', 'Home', 'Other'])
      question('product', 'Which product would you like to enquire about?')
      question('preference', 'What size, colour or other preference do you have?')
      question('quantity', 'What quantity do you need? Enter a number.', 'NUMBER')
      question('required_date', 'When do you need it? Use YYYY-MM-DD.', 'DATE')
      options(
        'confirm',
        'Please review your enquiry:\nCategory: {{vars.category}}\nProduct: {{vars.product}}\nPreference: {{vars.preference}}\nQuantity: {{vars.quantity}}\nRequired date: {{vars.required_date}}\nIs this correct?',
        ['Confirm', 'Need changes'],
      )
      add('confirmed', 'condition.equals', {
        subject: '{{vars.confirm}}',
        value: 'Confirm',
        caseSensitive: false,
      })
      const ids = [
        'greeting',
        'category',
        'product',
        'preference',
        'quantity',
        'required_date',
        'confirm',
        'confirmed',
      ]
      ids.slice(1).forEach((n, i) => link(ids[i]!, n))
      link('confirmed', 'acknowledgement', 'yes')
      link('confirmed', 'handover', 'no')
    } else if (id === 'blank') {
      question('enquiry', 'How can our team help with your enquiry?')
      link('greeting', 'enquiry')
      link('enquiry', 'acknowledgement')
      nodes.find((n) => n.id === 'handover')!.config.note = 'Customer enquiry: {{vars.enquiry}}'
    } else {
      options('topic', 'What would you like help with?', [
        'Location',
        'Opening hours',
        'Talk to our team',
      ])
      add('location-check', 'condition.equals', {
        subject: '{{vars.topic}}',
        value: 'Location',
        caseSensitive: false,
      })
      add('hours-check', 'condition.equals', {
        subject: '{{vars.topic}}',
        value: 'Opening hours',
        caseSensitive: false,
      })
      message('location-answer', 'You can find us at [enter your address].')
      message('hours-answer', 'Our opening hours are [enter your opening hours].')
      link('greeting', 'topic')
      link('topic', 'location-check')
      link('location-check', 'location-answer', 'yes')
      link('location-check', 'hours-check', 'no')
      link('hours-check', 'hours-answer', 'yes')
      link('hours-check', 'acknowledgement', 'no')
      link('location-answer', 'acknowledgement')
      link('hours-answer', 'acknowledgement')
    }
    nodes
      .filter((n) => n.type === 'action.question' || n.type === 'action.options')
      .forEach((n) => link(n.id, 'handover', 'error'))
  }
  return { nodes, edges, layout: {}, replyStudio: settings }
}

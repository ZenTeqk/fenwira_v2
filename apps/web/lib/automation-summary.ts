import { type DraftGraph, type EdgeHandle, isCondition, isTrigger } from '@fenwira/contracts'

/**
 * The builder's plain-language sentence ("When a message contains “price”, add the tag lead,
 * assign to whoever is online, then send “Thanks…”"). Pure: names of tags, templates and
 * teammates come from the caller, so it is unit-tested without React.
 */
export type SummaryNames = {
  tag?: (id: string) => string | undefined
  template?: (id: string) => string | undefined
  member?: (id: string) => string | undefined
}

type Node = DraftGraph['nodes'][number]
type Config = Record<string, unknown>

const VALUE_LABEL: Record<string, string> = {
  'contact.firstName': 'first name',
  'contact.name': 'name',
  'contact.phone': 'phone',
  'contact.email': 'email',
  'trigger.message.text': 'message text',
}

/** `{{contact.firstName}}` reads as [first name]; long text is cut to a short quote. */
function quote(text: string, max = 40): string {
  const friendly = text
    .replace(
      /\{\{\s*([\w.]+)\s*\}\}/g,
      (_, p: string) => `[${VALUE_LABEL[p] ?? p.split('.').at(-1)}]`,
    )
    .replace(/\s+/g, ' ')
    .trim()
  return `“${friendly.length > max ? `${friendly.slice(0, max - 1).trimEnd()}…` : friendly}”`
}

const ids = (v: unknown) => (Array.isArray(v) ? (v as string[]) : [])
const or = (items: string[], word = 'or') =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} ${word} ${items.at(-1)}`

function tags(c: Config, names: SummaryNames): string {
  const list = ids(c.tagIds).map((id) => names.tag?.(id) ?? 'a tag')
  if (!list.length) return 'a tag'
  return `${list.length === 1 ? 'the tag' : 'the tags'} ${or(list, 'and')}`
}

const SOURCE: Record<string, string> = {
  INBOUND: 'by messaging you',
  MANUAL: 'by your team',
  IMPORT: 'from an import',
  API: 'through the API',
  CAMPAIGN: 'from a campaign',
  AUTOMATION: 'by an automation',
}

export function triggerClause(node: Pick<Node, 'type' | 'config'> | undefined): string {
  if (!node) return 'When the trigger is set'
  const c = node.config as Config
  switch (node.type) {
    case 'trigger.keyword': {
      const words = ids(c.keywords).filter(Boolean)
      const verb =
        c.match === 'CONTAINS' ? 'contains' : c.match === 'STARTS_WITH' ? 'starts with' : 'is'
      return words.length
        ? `When a message ${verb} ${or(words.map((w) => quote(w)))}`
        : 'When a message matches your keywords'
    }
    case 'trigger.message_received':
      return c.onlyNewConversation
        ? 'When someone starts a new conversation'
        : 'When a message arrives'
    case 'trigger.contact_created': {
      const from = ids(c.sources).map((s) => SOURCE[s] ?? s.toLowerCase())
      return from.length ? `When a contact is added ${or(from)}` : 'When a contact is added'
    }
    case 'trigger.webhook':
      return 'When your system calls the webhook'
    default:
      return 'When the trigger happens'
  }
}

function conditionClause(n: Node, names: SummaryNames): string {
  const c = n.config as Config
  const subject = (v: unknown) => quote(String(v ?? '') || '…')
  switch (n.type) {
    case 'condition.business_hours':
      return 'your business is open'
    case 'condition.has_tag':
      return `the contact has ${c.match === 'ALL' ? 'all of ' : ''}${tags(c, names)}`
    case 'condition.equals':
      return `${subject(c.subject)} is ${subject(c.value)}`
    case 'condition.contains':
      return `${subject(c.subject)} contains ${subject(c.value)}`
    case 'condition.exists':
      return `${subject(c.subject)} is set`
    case 'condition.contact_property':
      if (c.key === 'lastInboundAt' && c.operator === 'IN_LAST_DAYS')
        return `the contact replied in the last ${Number(c.value) === 1 ? 'day' : `${String(c.value)} days`}`
      return `the contact’s ${String(c.key || 'field')} ${String(c.operator ?? '')
        .toLowerCase()
        .replaceAll(
          '_',
          ' ',
        )}${c.value === undefined || c.value === '' ? '' : ` ${String(c.value)}`}`
    default:
      return 'the condition is met'
  }
}

function actionPhrase(n: Node, names: SummaryNames): string | null {
  const c = n.config as Config
  switch (n.type) {
    case 'action.question':
      return `ask and save ${String(c.field ?? 'the answer')}`
    case 'action.options':
      return 'offer options and wait for a choice'
    case 'action.handover':
      return 'hand the enquiry to your team'
    case 'action.send_message':
      return String(c.text ?? '').trim() ? `send ${quote(String(c.text))}` : 'send a message'
    case 'action.send_template': {
      const name = c.templateId ? names.template?.(String(c.templateId)) : undefined
      return name ? `send the template “${name}”` : 'send a template'
    }
    case 'action.add_tag':
      return `add ${tags(c, names)}`
    case 'action.remove_tag':
      return `remove ${tags(c, names)}`
    case 'action.assign_agent':
      return c.mode === 'USER'
        ? `assign to ${(c.userId && names.member?.(String(c.userId))) || 'a teammate'}`
        : 'assign to whoever is online'
    case 'action.update_contact':
      return 'update the contact'
    case 'action.webhook':
      return 'call your system'
    case 'action.delay': {
      const unit = String(c.unit ?? 'HOURS')
        .toLowerCase()
        .replace(/s$/, '')
      const amount = Number(c.amount) || 0
      return `wait ${amount} ${unit}${amount === 1 ? '' : 's'}`
    }
    case 'action.ai_reply':
      return 'answer with the AI Assistant'
    default:
      return null
  }
}

/** Joins "a, b, then c". */
const sequence = (parts: string[]) =>
  parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')}, then ${parts.at(-1)}`

/** Sentence for an empty flow, a trigger only, or a whole flow (branches up to two levels). */
export function describeFlow(g: DraftGraph, names: SummaryNames = {}): string {
  const byId = new Map(g.nodes.map((n) => [n.id, n]))
  const next = (id: string, handle: EdgeHandle) => {
    const e = g.edges.find((x) => x.source === id && x.sourceHandle === handle)
    return e ? byId.get(e.target) : undefined
  }
  const trigger = g.nodes.find((n) => isTrigger(n.type))
  if (!trigger) return 'Add a trigger to say when this automation starts.'

  const seen = new Set<string>()
  const path = (start: Node | undefined, depth: number): string[] => {
    const parts: string[] = []
    let n = start
    while (n && !seen.has(n.id)) {
      seen.add(n.id)
      if (isCondition(n.type)) {
        const cond = conditionClause(n, names)
        if (depth > 1) {
          parts.push(`check whether ${cond}`)
          break
        }
        const yes = sequence(path(next(n.id, 'yes'), depth + 1)) || 'stop'
        const no = sequence(path(next(n.id, 'no'), depth + 1)) || 'stop'
        parts.push(`if ${cond}, ${yes}; otherwise ${no}`)
        break
      }
      const phrase = actionPhrase(n, names)
      if (phrase) {
        const onError = next(n.id, 'error')
        const fallback = onError ? actionPhrase(onError, names) : null
        parts.push(fallback ? `${phrase} (if it fails, ${fallback})` : phrase)
      }
      n = n.type === 'action.ai_reply' ? undefined : next(n.id, 'next')
    }
    return parts
  }
  const steps = path(next(trigger.id, 'next'), 0)
  const when = triggerClause(trigger)
  return steps.length ? `${when}, ${sequence(steps)}.` : `${when}, … (add the next step).`
}

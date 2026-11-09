import { type ContactActivity, type Message } from '@fenwira/contracts'

const countries = new Intl.DisplayNames(['en'], { type: 'region' })
export function countryLabel(code: string): string {
  try {
    return countries.of(code.trim().toUpperCase()) ?? code
  } catch {
    return code
  }
}
export type CustomerActivity = {
  id: string
  at: string
  text: string
  actor?: string
  kind: 'assignment' | 'tag' | 'note' | 'automation' | 'sales'
}
const text = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

function salesText(type: string, data: Record<string, unknown>): string | undefined {
  const stage = text(data.stage)
  if (type === 'opportunity.created') return `Opportunity created${stage ? ` in ${stage}` : ''}`
  if (type === 'opportunity.stage_changed')
    return `Sales stage: ${text(data.from) ?? '?'} → ${text(data.to) ?? '?'}`
  if (type === 'opportunity.won') return 'Opportunity won'
  if (type === 'opportunity.lost') return 'Opportunity lost'
  if (type === 'opportunity.reopened') return 'Opportunity reopened'
  if (type === 'opportunity.owner_changed') return `Sales owner: ${text(data.to) ?? 'no owner'}`
  return undefined
}

/** Summarize only recorded assignment, tag, contact-note, sales and automation events. */
export function customerActivity(
  activities: ContactActivity[],
  messages: Message[],
  since?: string,
): CustomerActivity[] {
  const result: CustomerActivity[] = []
  for (const event of activities) {
    const tag = text(event.data.tag)
    if (event.type === 'tag.added' || event.type === 'tag.removed')
      result.push({
        id: `contact-${event.id}`,
        at: event.occurredAt,
        kind: 'tag',
        actor: event.actorName ?? undefined,
        text: `${event.type === 'tag.added' ? 'Added' : 'Removed'} tag${tag ? ` “${tag}”` : ''}`,
      })
    // Sales (docs/FOLLOW_UPS_AND_SALES.md): stage, owner and outcome history.
    const sales = salesText(event.type, event.data)
    if (sales)
      result.push({
        id: `contact-${event.id}`,
        at: event.occurredAt,
        kind: 'sales',
        actor: event.actorName ?? undefined,
        text: sales,
      })
    if (event.type === 'note.added')
      result.push({
        id: `contact-${event.id}`,
        at: event.occurredAt,
        kind: 'note',
        actor: event.actorName ?? undefined,
        text: 'Contact note added',
      })
  }
  for (const message of messages) {
    if (message.direction !== 'SYSTEM' || message.content.type !== 'SYSTEM_EVENT') continue
    const event = message.content.event
    const data: Record<string, unknown> =
      message.content.data &&
      typeof message.content.data === 'object' &&
      !Array.isArray(message.content.data)
        ? (message.content.data as Record<string, unknown>)
        : {}
    const actor = text(data.actorName)
    let description: string | undefined
    let kind: CustomerActivity['kind'] = 'automation'
    if (event === 'assigned') {
      description = `Assigned to ${text(data.toName) ?? 'an agent'}`
      kind = 'assignment'
    } else if (event === 'unassigned') {
      description = 'Conversation unassigned'
      kind = 'assignment'
    } else if (event === 'takeover') description = 'Agent took over from automation'
    else if (event === 'automation_paused') description = 'Automation paused'
    else if (event === 'automation_resumed')
      description =
        data.reason === 'auto_release' ? 'Automation resumed automatically' : 'Automation resumed'
    else if (event === 'ai_handoff') description = 'AI handed the conversation to an agent'
    if (description)
      result.push({
        id: `message-${message.id}`,
        at: message.createdAt,
        kind,
        text: description,
        actor,
      })
  }
  return [...new Map(result.map((event) => [event.id, event])).values()]
    .filter((event) => !since || event.at >= since)
    .sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id))
}
/** The covered interval must be complete in both sources before older records are displayed. */
export function activityWatermark(
  contactDates: string[],
  contactHasMore: boolean,
  messageDates: string[],
  messagesHaveMore: boolean,
): string | undefined {
  const oldest = (dates: string[]) =>
    dates.reduce<string | undefined>((min, at) => (!min || at < min ? at : min), undefined)
  return [
    contactHasMore ? oldest(contactDates) : undefined,
    messagesHaveMore ? oldest(messageDates) : undefined,
  ]
    .filter((at): at is string => !!at)
    .sort()
    .at(-1)
}

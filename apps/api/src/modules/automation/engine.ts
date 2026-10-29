import {
  businessHoursSchema,
  businessIsOpen,
  DEFAULT_BUSINESS_HOURS,
  type EdgeHandle,
  evaluateExpression,
  type ExpressionContext,
  fieldKind,
  type FlowGraph,
  type FlowNode,
  type Operator,
} from '@fenwira/contracts'
import { type Prisma, type TenantTx } from '@fenwira/database'
import { AppError } from '../../core/http/app-error'
import { addActivity, coercePropertyValue, FilterCompiler, propertyOut } from '../contacts'
import { assignConversation } from '../inbox'
import { type ExecutionRow } from './automation.core'

/**
 * Node handlers that run inside the step transaction (docs/AUTOMATION_ENGINE.md → Node catalog):
 * conditions and database actions. Handlers are pure functions of the pinned graph, the execution
 * context and DB reads in this transaction; no randomness, and time only in `delay`.
 */

type NodeOf<T extends FlowNode['type']> = Extract<FlowNode, { type: T }>

export type Outcome = {
  status: 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'WAITING'
  handle?: EdgeHandle
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  errorCode?: string
  errorDetail?: string
  waitUntil?: Date
  reply?: Record<string, unknown>
  replyWait?: boolean
  /** Ends the execution with this status (end node, takeover). */
  terminal?: 'COMPLETED' | 'STOPPED_TAKEOVER'
  /** Values saved into `vars` (webhook saveResponseAs). */
  vars?: Record<string, unknown>
  /** Realtime pushes to do after commit. */
  notify?: { userId: string; notification: unknown }
  /** AI conversation mode: stay on this step and wait for the customer's next message. */
  stay?: { handledMessageId: string }
  /** AI handed the conversation to a person: takeover is applied with the step. */
  aiHandoff?: true
}

export const failed = (code: string, detail: string, input?: Record<string, unknown>): Outcome => ({
  status: 'FAILED',
  handle: 'error',
  errorCode: code,
  errorDetail: detail,
  input,
})

export type Context = ExpressionContext & {
  contact: {
    id: string
    name: string
    firstName: string
    phone: string
    email: string
    language: string
    country: string
    property: Record<string, unknown>
  }
}

/** The execution context (contact, trigger, vars), loaded in the step transaction. */
export async function loadContext(tx: TenantTx, e: ExecutionRow): Promise<Context | null> {
  const c = await tx.contact.findFirst({ where: { id: e.contactId, deletedAt: null } })
  if (!c) return null
  const values = await tx.contactPropertyValue.findMany({
    where: { contactId: c.id },
    include: { definition: { select: { key: true, type: true } } },
  })
  const property: Record<string, unknown> = {}
  for (const v of values) property[v.definition.key] = propertyOut(v.definition.type, v)
  const name = c.name ?? c.waProfileName ?? ''
  return {
    contact: {
      id: c.id,
      name,
      firstName: name.split(/\s+/)[0] ?? '',
      phone: c.phoneE164,
      email: c.email ?? '',
      language: c.language ?? '',
      country: c.country ?? '',
      property,
    },
    trigger: e.triggerEvent as Record<string, unknown>,
    vars: ((e.context as { vars?: Record<string, unknown> }).vars ?? {}) as Record<string, unknown>,
  }
}

export const nodeById = (graph: FlowGraph, id: string | null) =>
  id ? graph.nodes.find((n) => n.id === id) : undefined

export const edgeFrom = (graph: FlowGraph, nodeId: string, handle: EdgeHandle) =>
  graph.edges.find((e) => e.source === nodeId && e.sourceHandle === handle)

const DELAY_MS = { MINUTES: 60_000, HOURS: 3_600_000, DAYS: 86_400_000 } as const

/** Nodes handled inside the step transaction. Sends, webhooks and round-robin are external. */
export const isExternal = (node: FlowNode) =>
  node.type === 'action.question' ||
  node.type === 'action.options' ||
  node.type === 'action.send_message' ||
  node.type === 'action.send_template' ||
  node.type === 'action.webhook' ||
  node.type === 'action.ai_reply' ||
  (node.type === 'action.assign_agent' && node.config.mode === 'ROUND_ROBIN')

export async function runInternal(
  tx: TenantTx,
  e: ExecutionRow,
  node: FlowNode,
  ctx: Context,
  now: Date,
): Promise<Outcome> {
  const ev = (text: string) => evaluateExpression(text, ctx)
  switch (node.type) {
    case 'trigger.message_received':
    case 'trigger.keyword':
    case 'trigger.contact_created':
    case 'trigger.webhook':
      return { status: 'SUCCEEDED', handle: 'next', output: { eventType: node.type } }
    case 'condition.business_hours': {
      const workspace = await tx.tenant.findUniqueOrThrow({ where: { id: e.tenantId } })
      const schedule = businessHoursSchema.parse(workspace.businessHours ?? DEFAULT_BUSINESS_HOURS)
      return yesNo(businessIsOpen(schedule, now), {
        at: now.toISOString(),
        timezone: schedule.timezone,
      })
    }
    case 'condition.equals':
    case 'condition.contains': {
      const fold = (s: string) => (node.config.caseSensitive ? s : s.toLowerCase())
      const subject = fold(ev(node.config.subject).trim())
      const value = fold(ev(node.config.value).trim())
      const result =
        node.type === 'condition.equals' ? subject === value : !!value && subject.includes(value)
      return yesNo(result, { subject, value })
    }
    case 'condition.exists': {
      const subject = ev(node.config.subject).trim()
      return yesNo(subject.length > 0, { subject })
    }
    case 'condition.has_tag': {
      const ids = [...new Set(node.config.tagIds)]
      const n = await tx.contactTag.count({ where: { contactId: e.contactId, tagId: { in: ids } } })
      const result = node.config.match === 'ALL' ? n === ids.length : n > 0
      return yesNo(result, { tagIds: ids, match: node.config.match })
    }
    case 'condition.contact_property':
      return contactProperty(tx, e, node, now)
    case 'action.add_tag':
    case 'action.remove_tag':
      return tagAction(tx, e, node)
    case 'action.assign_agent':
      return assignUser(tx, e, node)
    case 'action.update_contact':
      return updateContact(tx, e, node, ev)
    case 'action.delay': {
      const waitUntil = new Date(now.getTime() + node.config.amount * DELAY_MS[node.config.unit])
      return {
        status: 'WAITING',
        handle: 'next',
        waitUntil,
        input: { amount: node.config.amount, unit: node.config.unit },
        output: { waitUntil: waitUntil.toISOString() },
      }
    }
    case 'action.handover': {
      if (!e.conversationId) return failed('NO_CONVERSATION', 'Handover needs a conversation.')
      const flow = await tx.flow.findFirstOrThrow({ where: { id: e.flowId } })
      if (!flow.createdBy)
        return failed('FLOW_REFERENCE_MISSING', 'Choose an owner for this enquiry.')
      // Let an already queued acknowledgement reach Meta before takeover cancels bot sends.
      const lastSend = await tx.automationExecutionStep.findFirst({
        where: { executionId: e.id, nodeType: 'action.send_message' },
        orderBy: { seq: 'desc' },
      })
      const messageId = (lastSend?.output as { messageId?: string } | undefined)?.messageId
      const acknowledgement = messageId
        ? await tx.message.findFirst({ where: { id: messageId } })
        : null
      if (acknowledgement && ['CREATED', 'QUEUED', 'SENDING'].includes(acknowledgement.status))
        return {
          status: 'WAITING',
          replyWait: true,
          waitUntil: new Date(now.getTime() + 2000),
          output: { awaitingAcknowledgement: true },
        }
      if (node.config.tagIds.length) {
        const tags = await tagAction(tx, e, {
          id: node.id,
          type: 'action.add_tag',
          config: { tagIds: node.config.tagIds },
        })
        if (tags.status === 'FAILED') return tags
      }
      if (node.config.userId) {
        const assigned = await assignUser(tx, e, {
          id: node.id,
          type: 'action.assign_agent',
          config: { mode: 'USER', userId: node.config.userId },
        })
        if (assigned.status === 'FAILED') return assigned
      }
      await tx.conversationNote.create({
        data: {
          tenantId: e.tenantId,
          conversationId: e.conversationId,
          authorId: flow.createdBy,
          body: ev(node.config.note),
          mentions: [],
        },
      })
      await tx.conversation.update({
        where: { id: e.conversationId },
        data: { automationState: 'AGENT_TAKEOVER', automationStateChangedAt: now },
      })
      await tx.outboxEvent.create({
        data: {
          tenantId: e.tenantId,
          eventType: 'conversation.automation_state.changed',
          aggregateType: 'conversation',
          aggregateId: e.conversationId,
          payload: {
            conversationId: e.conversationId,
            from: 'AUTOMATION_ACTIVE',
            to: 'AGENT_TAKEOVER',
            actorId: null,
          },
        },
      })
      return { status: 'SUCCEEDED', terminal: 'COMPLETED', output: { handover: true } }
    }
    case 'action.end':
      return { status: 'SUCCEEDED', terminal: 'COMPLETED' }
    default:
      throw new Error(`${node.type} is not an internal node`)
  }
}

const yesNo = (result: boolean, input: Record<string, unknown>): Outcome => ({
  status: 'SUCCEEDED',
  handle: result ? 'yes' : 'no',
  input,
  output: { result },
})

/** Reuses the contacts filter DSL: one rule compiled by FilterCompiler, scoped to this contact. */
async function contactProperty(
  tx: TenantTx,
  e: ExecutionRow,
  node: NodeOf<'condition.contact_property'>,
  now: Date,
): Promise<Outcome> {
  const field = fieldKind(node.config.key) ? node.config.key : `property.${node.config.key}`
  const rule = { field, operator: node.config.operator as Operator, value: node.config.value }
  try {
    const where = await new FilterCompiler(tx, { now }).compile({ op: 'AND', rules: [rule] })
    const n = await tx.contact.count({ where: { AND: [where, { id: e.contactId }] } })
    return yesNo(n > 0, { field, operator: rule.operator, value: rule.value })
  } catch (err) {
    if (err instanceof AppError)
      return failed('FLOW_NODE_CONFIG_INVALID', err.fieldErrors?.[0]?.message ?? err.message)
    throw err
  }
}

async function tagAction(
  tx: TenantTx,
  e: ExecutionRow,
  node: NodeOf<'action.add_tag' | 'action.remove_tag'>,
): Promise<Outcome> {
  const ids = [...new Set(node.config.tagIds)]
  const tags = await tx.tag.findMany({ where: { id: { in: ids } } })
  if (tags.length !== ids.length)
    return failed('FLOW_REFERENCE_MISSING', 'A tag used by this step was deleted.', { tagIds: ids })
  const adding = node.type === 'action.add_tag'
  const existing = new Set(
    (
      await tx.contactTag.findMany({
        where: { contactId: e.contactId, tagId: { in: ids } },
        select: { tagId: true },
      })
    ).map((t) => t.tagId),
  )
  // Idempotent by construction: only tags whose state changes are written and logged.
  const changed = tags.filter((t) => (adding ? !existing.has(t.id) : existing.has(t.id)))
  if (adding)
    await tx.contactTag.createMany({
      data: changed.map((t) => ({ tenantId: e.tenantId, contactId: e.contactId, tagId: t.id })),
      skipDuplicates: true,
    })
  else
    await tx.contactTag.deleteMany({
      where: { contactId: e.contactId, tagId: { in: changed.map((t) => t.id) } },
    })
  for (const t of changed)
    await addActivity(tx, {
      tenantId: e.tenantId,
      contactId: e.contactId,
      type: adding ? 'tag.added' : 'tag.removed',
      data: { tagId: t.id, tag: t.name, automation: { executionId: e.id } },
      actorId: null,
    })
  return {
    status: 'SUCCEEDED',
    handle: 'next',
    input: { tagIds: ids },
    output: { changed: changed.map((t) => t.id) },
  }
}

async function assignUser(
  tx: TenantTx,
  e: ExecutionRow,
  node: NodeOf<'action.assign_agent'>,
): Promise<Outcome> {
  if (!e.conversationId)
    return failed('NO_CONVERSATION', 'This contact has no conversation to assign.')
  const conversation = await tx.conversation.findFirst({ where: { id: e.conversationId } })
  if (!conversation) return failed('NO_CONVERSATION', 'The conversation no longer exists.')
  try {
    const pushed = await assignConversation(tx, {
      tenantId: e.tenantId,
      conversation,
      assigneeId: node.config.userId!,
      actor: { id: null, name: null },
    })
    return {
      status: 'SUCCEEDED',
      handle: 'next',
      input: { mode: 'USER' },
      output: { assigneeId: node.config.userId },
      notify: pushed ?? undefined,
    }
  } catch (err) {
    if (err instanceof AppError)
      return failed('FLOW_REFERENCE_MISSING', 'The teammate can no longer be assigned.', {
        mode: 'USER',
      })
    throw err
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const LANGUAGE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/

async function updateContact(
  tx: TenantTx,
  e: ExecutionRow,
  node: NodeOf<'action.update_contact'>,
  ev: (text: string) => string,
): Promise<Outcome> {
  // Validate every update first, then write: the step changes all fields or none.
  const data: Prisma.ContactUpdateInput = {}
  const properties: Array<{ definitionId: string; value: Coerced['value'] }> = []
  const changed: string[] = []
  const input: Record<string, unknown> = {}
  for (const u of node.config.updates) {
    const value = ev(u.value).trim()
    input[u.field] = value
    changed.push(u.field)
    if (u.field === 'name') data.name = value.slice(0, 120) || null
    else if (u.field === 'language') {
      if (value && !LANGUAGE.test(value))
        return failed('CONTACT_VALUE_INVALID', `"${value}" is not a language code.`, input)
      data.language = value || null
    } else if (u.field === 'email') {
      if (value && !EMAIL.test(value))
        return failed('CONTACT_VALUE_INVALID', `"${value}" is not an email address.`, input)
      data.email = value || null
    } else {
      const key = u.field.slice('property.'.length)
      const def = await tx.contactPropertyDefinition.findFirst({
        where: { key, archivedAt: null },
      })
      if (!def)
        return failed(
          'FLOW_REFERENCE_MISSING',
          `The contact property "${key}" no longer exists.`,
          input,
        )
      const coerced = coercePropertyValue(def, value)
      if ('error' in coerced) return failed('CONTACT_VALUE_INVALID', coerced.error, input)
      properties.push({ definitionId: def.id, value: coerced.value })
    }
  }
  if (Object.keys(data).length) await tx.contact.update({ where: { id: e.contactId }, data })
  for (const p of properties)
    if (p.value)
      await tx.contactPropertyValue.upsert({
        where: { contactId_definitionId: { contactId: e.contactId, definitionId: p.definitionId } },
        create: {
          tenantId: e.tenantId,
          contactId: e.contactId,
          definitionId: p.definitionId,
          ...p.value,
        },
        update: p.value,
      })
    else
      await tx.contactPropertyValue.deleteMany({
        where: { contactId: e.contactId, definitionId: p.definitionId },
      })
  await addActivity(tx, {
    tenantId: e.tenantId,
    contactId: e.contactId,
    type: 'contact.updated',
    data: { fields: changed, automation: { executionId: e.id } },
    actorId: null,
  })
  await tx.outboxEvent.create({
    data: {
      tenantId: e.tenantId,
      eventType: 'contact.updated',
      aggregateType: 'contact',
      aggregateId: e.contactId,
      payload: { contactId: e.contactId, changedFields: changed },
    },
  })
  return { status: 'SUCCEEDED', handle: 'next', input, output: { fields: changed } }
}

type Coerced = Extract<ReturnType<typeof coercePropertyValue>, { value: unknown }>

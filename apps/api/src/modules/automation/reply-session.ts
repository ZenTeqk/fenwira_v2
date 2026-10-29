import {
  evaluateExpression,
  normalizeReplyText,
  type FlowGraph,
  type FlowNode,
  type SendableContent,
} from '@fenwira/contracts'
import { type TenantTx } from '@fenwira/database'
import { type ExecutionRow } from './automation.core'
import { loadContext, runInternal, failed, type Context, type Outcome } from './engine'

export type ReplyNode = Extract<FlowNode, { type: 'action.question' | 'action.options' }>
export type ReplyState = {
  cursor?: string
  promptNode?: string
  attempts?: number
  deadline?: string
  staleReplied?: boolean
}
export const replyState = (e: ExecutionRow): ReplyState =>
  (e.context as { reply?: ReplyState }).reply ?? {}

/** The database inbox is the durable FIFO, ordered by receipt timestamp and id. No Redis state. */
export async function nextReply(tx: TenantTx, e: ExecutionRow) {
  if (!e.conversationId) return null
  const cursorId =
    replyState(e).cursor ?? (e.triggerEvent as { message?: { id?: string } }).message?.id
  const cursor = cursorId ? await tx.message.findFirst({ where: { id: cursorId } }) : null
  const next = await tx.message.findFirst({
    where: {
      conversationId: e.conversationId,
      direction: 'INBOUND',
      ...(cursor
        ? {
            OR: [
              { createdAt: { gt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { gt: cursor.id } },
            ],
          }
        : { createdAt: { gt: e.startedAt } }),
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  if (!next) return null
  // Routing must classify restart/expiry before the interpreter may consume an answer.
  const receipt = await tx.automationTriggerRun.findFirst({
    where: {
      AND: [
        { triggerEvent: { path: ['message', 'id'], equals: next.id } },
        { triggerEvent: { path: ['executionId'], equals: e.id } },
      ],
    },
    select: { id: true },
  })
  return receipt ? next : null
}
export function answerValue(node: ReplyNode, text: string): string | null {
  const value = text.trim()
  if (!value) return null
  if (node.type === 'action.options') {
    const normalized = normalizeReplyText(value)
    return (
      node.config.options.find((o, i) =>
        [normalizeReplyText(o.value), normalizeReplyText(o.label), String(i + 1)].includes(
          normalized,
        ),
      )?.value ?? null
    )
  }
  if (
    node.config.answerType === 'NUMBER' &&
    (!Number.isFinite(Number(value)) || Number(value) <= 0)
  )
    return null
  if (
    node.config.answerType === 'DATE' &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      Number.isNaN(Date.parse(value)) ||
      new Date(value).toISOString().slice(0, 10) !== value)
  )
    return null
  if (node.config.answerType === 'EMAIL' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return null
  return value.slice(0, 4096)
}
export function replyPrompt(
  e: ExecutionRow,
  node: ReplyNode,
  ctx: Context,
): Extract<SendableContent, { type: 'TEXT' | 'INTERACTIVE' }> {
  const text = evaluateExpression(node.config.text, ctx).slice(
    0,
    node.type === 'action.options' ? 1024 : 4096,
  )
  if (node.type === 'action.question') return { type: 'TEXT', text }
  return {
    type: 'INTERACTIVE',
    text,
    presentation: node.config.presentation,
    options: node.config.options.map((o) => ({
      id: `rs:${e.id}:${node.id}:${o.value}`,
      label: o.label,
    })),
    ...(node.config.url ? { url: node.config.url } : {}),
  }
}
export type ReplyPlan = { content?: SendableContent; outcome: Outcome }
export async function prepareReply(
  tx: TenantTx,
  e: ExecutionRow,
  node: ReplyNode,
  ctx: Context,
  graph: FlowGraph,
  now: Date,
): Promise<ReplyPlan> {
  if (!e.conversationId)
    return { outcome: failed('NO_CONVERSATION', 'This question needs a conversation.') }
  const settings = graph.replyStudio
  const state = replyState(e)
  const conversation = await tx.conversation.findFirstOrThrow({ where: { id: e.conversationId } })
  const incoming = state.promptNode === node.id ? await nextReply(tx, e) : null
  const expired =
    !!state.deadline && (incoming?.createdAt ?? now).getTime() >= Date.parse(state.deadline)
  if (expired)
    return {
      ...(settings?.closingMessage &&
      conversation.serviceWindowExpiresAt &&
      conversation.serviceWindowExpiresAt > now
        ? { content: { type: 'TEXT' as const, text: settings.closingMessage } }
        : {}),
      outcome: {
        status: 'SUCCEEDED',
        terminal: 'COMPLETED',
        errorCode: 'SESSION_EXPIRED',
        output: { expired: true },
        reply: { ...state, promptNode: null },
      },
    }
  const deadline = new Date(
    Math.min(
      now.getTime() + (settings?.expiryMinutes ?? 1440) * 60000,
      conversation.serviceWindowExpiresAt?.getTime() ?? now.getTime(),
    ),
  ).toISOString()
  const wait = (patch: Record<string, unknown> = {}): Outcome => ({
    status: 'WAITING',
    replyWait: true,
    waitUntil: new Date(state.deadline ?? deadline),
    reply: { ...state, promptNode: node.id, deadline: state.deadline ?? deadline, ...patch },
  })
  if (state.promptNode !== node.id)
    return { content: replyPrompt(e, node, ctx), outcome: wait({ attempts: 0 }) }
  if (!incoming) return { outcome: wait() }
  const content = incoming.content as { text?: string; replyId?: string }
  let text = content.text ?? ''
  if (content.replyId?.startsWith('rs:')) {
    const prefix = `rs:${e.id}:${node.id}:`
    if (!content.replyId.startsWith(prefix)) {
      // One stale notice per current menu; repeated taps show only the current menu.
      const prompt = replyPrompt(e, node, ctx)
      const notice = 'That option is no longer available. '
      return {
        content: {
          ...prompt,
          text: `${state.staleReplied ? '' : notice}${prompt.text}`.slice(
            0,
            node.type === 'action.options' ? 1024 : 4096,
          ),
        },
        outcome: wait({ cursor: incoming.id, staleReplied: true }),
      }
    }
    text = content.replyId.slice(prefix.length)
  }
  const value = answerValue(node, text)
  if (value === null) {
    const attempts = (state.attempts ?? 0) + 1
    if (attempts <= node.config.maxRetries)
      return {
        content: replyPrompt(e, node, ctx),
        outcome: wait({ cursor: incoming.id, attempts }),
      }
    const recent = await tx.automationExecutionStep.findFirst({
      where: {
        execution: { conversationId: e.conversationId },
        startedAt: { gte: new Date(now.getTime() - 86400000) },
        output: { path: ['fallbackSent'], equals: true },
      },
    })
    return {
      ...(!recent
        ? {
            content: {
              type: 'TEXT' as const,
              text: settings?.fallbackMessage ?? 'A teammate can help with your enquiry.',
            },
          }
        : {}),
      outcome: {
        status: 'SUCCEEDED',
        handle: 'error',
        output: { fallback: true, fallbackSent: !recent },
        reply: { ...state, cursor: incoming.id, promptNode: null, deadline: null },
      },
    }
  }
  return {
    outcome: {
      status: 'SUCCEEDED',
      handle: 'next',
      vars: { [node.config.field]: value },
      input: { messageId: incoming.id, field: node.config.field },
      output: { answerSaved: node.config.field },
      reply: {
        ...state,
        cursor: incoming.id,
        promptNode: null,
        attempts: 0,
        deadline,
        staleReplied: false,
      },
    },
  }
}
export async function saveReplyProperty(
  tx: TenantTx,
  e: ExecutionRow,
  node: FlowNode,
  outcome: Outcome,
) {
  if (node.type !== 'action.question' || !node.config.contactProperty || !outcome.vars) return
  // Use the existing typed contact-property handler, including its validation and audit trail.
  const ctx = await loadContext(tx, e)
  if (!ctx) return
  const result = await runInternal(
    tx,
    e,
    {
      id: node.id,
      type: 'action.update_contact',
      config: {
        updates: [
          { field: `property.${node.config.contactProperty}`, value: '{{vars.reply_answer}}' },
        ],
      },
    },
    { ...ctx, vars: { ...ctx.vars, reply_answer: String(outcome.vars[node.config.field]) } },
    new Date(),
  )
  if (result.status === 'FAILED') Object.assign(outcome, result, { vars: undefined })
}

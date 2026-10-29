import {
  evaluateExpression,
  type FlowGraph,
  type FlowNode,
  MAX_EXECUTION_STEPS,
  MEDIA_LIMITS,
  type SendableContent,
  type TemplateVariables,
} from '@fenwira/contracts'
import { type AiConfig, type HistoryTurn } from '@fenwira/ai'
import { Database, type Prisma, type TenantTx } from '@fenwira/database'
import { QUEUES } from '@fenwira/queue'
import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common'
import { type Job } from 'bullmq'
import { PinoLogger } from 'nestjs-pino'
import { AppError } from '../../core/http/app-error'
import { redactHeaders, redactUrl, safeFetch, SafeFetchError } from '../../core/http/safe-fetch'
import { MetricsService } from '../../core/metrics/metrics.service'
import { type QueueProcessor } from '../../core/queue/queue-processor'
import { QueueRegistry } from '../../core/queue/queue-registry'
import { RealtimeEmitter } from '../../core/realtime/realtime-emitter'
import { AI_CONFIG, AiAnswerService, conversationHistory, textOf } from '../ai'
import { EntitlementsService } from '../entitlements'
import { assignRoundRobin, PresenceService } from '../inbox'
import { MessagingService, type SendTarget } from '../messaging'
import {
  aiStateOf,
  applyAiHandoff,
  enqueueExecution,
  EXECUTE_JOB,
  handedOffByAi,
  type ExecutionRow,
  finishExecution,
  lockExecution,
  parseGraph,
  RECOVER_JOB,
  type StartEffects,
} from './automation.core'
import { nextReply, prepareReply, replyState, saveReplyProperty } from './reply-session'
import { AUTOMATION_OPTIONS, type AutomationOptions } from './automation.options'
import {
  type Context,
  edgeFrom,
  failed,
  isExternal,
  loadContext,
  nodeById,
  type Outcome,
  runInternal,
} from './engine'

/** Steps one job runs before yielding (docs/AUTOMATION_ENGINE.md → Execution semantics). */
export const STEPS_PER_JOB = 25
/** A RUNNING execution untouched this long is re-driven by recovery (worker died mid-run). */
const STALE_RUNNING_MS = 2 * 60_000
/** A paused flow's waiting executions look again after this long. */
const PAUSED_RECHECK_MS = 60_000
/** An AI conversation ends after this long without a customer message. */
export const AI_SILENCE_MS = 24 * 3600_000

type Data = { tenantId: string; executionId: string } | Record<string, never>

type Prepared =
  | {
      kind: 'send'
      target: SendTarget
      content: SendableContent
      input: Record<string, unknown>
      replyOutcome?: Outcome
    }
  | {
      kind: 'webhook'
      request: {
        method: 'GET' | 'POST'
        url: string
        headers: Record<string, string>
        body?: string
      }
      timeoutMs: number
      saveAs?: string
      input: Record<string, unknown>
    }
  | { kind: 'round_robin'; conversationId: string }
  | {
      kind: 'ai'
      conversationId: string
      messageId: string
      question: string
      history: HistoryTurn[]
      mode: 'SINGLE' | 'CONVERSATION'
      instructions: string | null
      input: Record<string, unknown>
    }

type StepPlan =
  | { done: string }
  | { external: Prepared; execution: ExecutionRow; node: FlowNode }
  | { continue: true }

/**
 * automation.execute: interprets one execution at a time on its pinned version.
 *  - Each step is its own transaction holding the execution row lock, so duplicate jobs or two
 *    workers can't run the same step twice.
 *  - DB actions commit with their step row. Sends go through MessagingService with the key
 *    `auto:{executionId}:{seq}` before the step is recorded; a retry returns the same message.
 *    Webhooks are at-least-once and carry `Idempotency-Key: auto:{executionId}:{seq}`.
 *  - Delays: WAITING + wait_until in Postgres plus a delayed job. Recovery (every 60 s, X16)
 *    re-enqueues due or stalled executions if Redis lost the job or a worker died.
 */
@Injectable()
export class AutomationExecuteProcessor implements QueueProcessor<Data>, OnApplicationBootstrap {
  readonly queue = QUEUES.automationExecute
  readonly concurrency = 10
  private retryTimer?: NodeJS.Timeout

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AUTOMATION_OPTIONS) private readonly options: AutomationOptions,
    private readonly queues: QueueRegistry,
    private readonly messaging: MessagingService,
    private readonly presence: PresenceService,
    private readonly entitlements: EntitlementsService,
    private readonly realtime: RealtimeEmitter,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger,
    private readonly ai: AiAnswerService,
    @Inject(AI_CONFIG) private readonly aiConfig: AiConfig,
  ) {
    this.logger.setContext('AutomationExecute')
  }

  onApplicationBootstrap(): void {
    void this.schedule(0)
  }

  onApplicationShutdown(): void {
    clearTimeout(this.retryTimer)
  }

  private async schedule(attempt: number): Promise<void> {
    try {
      await this.queues
        .get(this.queue)
        .upsertJobScheduler(
          'automation-recover',
          { every: 60_000 },
          { name: RECOVER_JOB, data: {}, opts: { removeOnComplete: 50, removeOnFail: 50 } },
        )
    } catch {
      this.retryTimer = setTimeout(
        () => void this.schedule(attempt + 1),
        Math.min(30_000, 1000 * 2 ** attempt),
      )
    }
  }

  async process(job: Job<Data>): Promise<unknown> {
    if (job.name === RECOVER_JOB) return this.recover()
    if (job.attemptsMade > 0) this.metrics.automationRetries.inc()
    const d = job.data as { tenantId: string; executionId: string }
    if (job.name !== EXECUTE_JOB || !d.tenantId) return 'ignored'
    try {
      return await this.run(d.tenantId, d.executionId)
    } catch (error) {
      if (job.attemptsMade + 1 < (job.opts.attempts ?? 3)) throw error
      const effects: StartEffects = { enqueue: [], started: 0, skipped: 0 }
      const after: Array<() => Promise<unknown> | void> = []
      await this.db.withTenant(d.tenantId, async (tx) => {
        await lockExecution(tx, d.executionId)
        const e = await tx.automationExecution.findFirst({ where: { id: d.executionId } })
        if (!e || (e.status !== 'RUNNING' && e.status !== 'WAITING')) return
        const graph = await this.graphOf(tx, e)
        const node = nodeById(graph, e.currentNodeId)
        const now = new Date()
        await tx.automationExecutionStep.create({
          data: {
            tenantId: d.tenantId,
            executionId: e.id,
            seq: e.stepCount + 1,
            nodeId: e.currentNodeId ?? 'unknown',
            nodeType: node?.type ?? 'unknown',
            status: 'FAILED',
            errorCode: 'FLOW_EXECUTION_FAILED',
            errorDetail:
              'The step could not finish after retrying. Check the connection and try a new session.',
            finishedAt: now,
          },
        })
        await this.terminate(
          tx,
          e,
          'FAILED',
          {
            code: 'FLOW_EXECUTION_FAILED',
            detail: 'The session failed after its retries were exhausted.',
          },
          now,
          effects,
          after,
        )
      })
      await this.flush(d.tenantId, effects, after)
      return 'failed'
    }
  }

  /** Runs up to STEPS_PER_JOB steps, then yields by re-enqueueing. */
  async run(tenantId: string, executionId: string): Promise<string> {
    for (let i = 0; i < STEPS_PER_JOB; i++) {
      const result = await this.step(tenantId, executionId)
      if (result !== 'continue') return result
    }
    const e = await this.db.withTenant(tenantId, (tx) =>
      tx.automationExecution.findFirst({ where: { id: executionId } }),
    )
    if (e?.status === 'RUNNING') await enqueueExecution(this.queues, tenantId, e.id, e.stepCount)
    return 'yield'
  }

  /** One step. Returns 'continue' to run the next step in this job. */
  async step(tenantId: string, executionId: string, now = new Date()): Promise<string> {
    const effects: StartEffects = { enqueue: [], started: 0, skipped: 0 }
    const after: Array<() => Promise<unknown> | void> = []
    const plan = await this.db.withTenant(tenantId, (tx) =>
      this.begin(tx, executionId, now, effects, after),
    )
    let result: string
    if ('done' in plan) result = plan.done
    else if ('continue' in plan) result = 'continue'
    else {
      const started = Date.now()
      const outcome = await this.external(plan.execution, plan.node, plan.external)
      result = await this.db.withTenant(tenantId, async (tx) => {
        await lockExecution(tx, executionId)
        const fresh = await tx.automationExecution.findFirst({ where: { id: executionId } })
        // Another worker (or a takeover/cancel) moved the execution on while we were out.
        if (
          !fresh ||
          fresh.status !== 'RUNNING' ||
          fresh.stepCount !== plan.execution.stepCount ||
          fresh.currentNodeId !== plan.node.id
        )
          return 'superseded'
        const graph = await this.graphOf(tx, fresh)
        return this.record(tx, fresh, graph, plan.node, outcome, new Date(), effects, after)
      })
      this.metrics.automationStepDuration.observe(
        { node_type: plan.node.type },
        (Date.now() - started) / 1000,
      )
    }
    await this.flush(tenantId, effects, after)
    return result
  }

  /** Phase 1 (in the step transaction): gates, then internal nodes run and commit here. */
  private async begin(
    tx: TenantTx,
    executionId: string,
    now: Date,
    effects: StartEffects,
    after: Array<() => Promise<unknown> | void>,
  ): Promise<StepPlan> {
    await lockExecution(tx, executionId)
    let e = await tx.automationExecution.findFirst({ where: { id: executionId } })
    if (!e) return { done: 'gone' }
    if (e.status === 'WAITING') {
      if (
        e.waitUntil &&
        e.waitUntil > now &&
        !(replyState(e).promptNode && (await nextReply(tx, e)))
      )
        return { done: 'not-due' }
      const flow = await tx.flow.findFirst({ where: { id: e.flowId }, select: { status: true } })
      if (flow?.status === 'PAUSED') {
        // Pause stops new executions; waiting ones look again in a minute (never lost).
        const until = new Date(now.getTime() + PAUSED_RECHECK_MS)
        await tx.automationExecution.update({ where: { id: e.id }, data: { waitUntil: until } })
        const id = e.id
        const stage = e.stepCount
        after.push(() =>
          enqueueExecution(this.queues, e!.tenantId, id, stage, {
            delay: PAUSED_RECHECK_MS,
            suffix: `p${until.getTime()}`,
          }),
        )
        return { done: 'flow-paused' }
      }
      e = await tx.automationExecution.update({
        where: { id: e.id },
        data: { status: 'RUNNING', waitUntil: null },
      })
    }
    if (e.status !== 'RUNNING') return { done: 'inactive' }

    const graph = await this.graphOf(tx, e)
    const node = nodeById(graph, e.currentNodeId)
    if (e.stepCount >= MAX_EXECUTION_STEPS) {
      await this.terminate(
        tx,
        e,
        'FAILED',
        {
          code: 'FLOW_STEP_LIMIT',
          detail: `Stopped after ${MAX_EXECUTION_STEPS} steps. Check the flow for a loop.`,
        },
        now,
        effects,
        after,
      )
      return { done: 'step-limit' }
    }
    // P10-D2: takeover is checked before every step.
    if (e.conversationId) {
      const conv = await tx.conversation.findFirst({
        where: { id: e.conversationId },
        select: { automationState: true },
      })
      // An execution that handed off to a person itself still finishes its Needs a human path.
      if (conv && conv.automationState !== 'AUTOMATION_ACTIVE' && !handedOffByAi(e)) {
        const paused = conv.automationState === 'AUTOMATION_PAUSED'
        await this.record(
          tx,
          e,
          graph,
          node ?? { id: e.currentNodeId ?? 'unknown', type: 'action.end', config: {} },
          {
            status: 'SKIPPED',
            terminal: 'STOPPED_TAKEOVER',
            errorCode: 'AUTOMATION_BLOCKED_BY_TAKEOVER',
            errorDetail: paused ? 'AUTOMATION_PAUSED' : 'AGENT_TAKEOVER',
          },
          now,
          effects,
          after,
        )
        return { done: 'takeover' }
      }
    }
    if (!node) {
      await this.terminate(
        tx,
        e,
        'FAILED',
        {
          code: 'FLOW_NODE_MISSING',
          detail: 'The next step is missing from this version.',
        },
        now,
        effects,
        after,
      )
      return { done: 'failed' }
    }
    const ctx = await loadContext(tx, e)
    if (!ctx) {
      await this.terminate(
        tx,
        e,
        'FAILED',
        {
          code: 'CONTACT_NOT_FOUND',
          detail: 'The contact was deleted.',
        },
        now,
        effects,
        after,
      )
      return { done: 'failed' }
    }
    if (node.type === 'action.question' || node.type === 'action.options') {
      const p = await prepareReply(tx, e, node, ctx, graph, now)
      if (p.content)
        return {
          external: {
            kind: 'send',
            target: { conversationId: e.conversationId! },
            content: p.content,
            input: {},
            replyOutcome: p.outcome,
          },
          execution: e,
          node,
        }
      const r = await this.record(tx, e, graph, node, p.outcome, now, effects, after)
      return r === 'continue' ? { continue: true } : { done: r }
    }
    if (isExternal(node)) {
      const prepared = await this.prepare(tx, e, node, ctx)
      if ('status' in prepared) {
        const r = await this.record(tx, e, graph, node, prepared, now, effects, after)
        return r === 'continue' ? { continue: true } : { done: r }
      }
      return { external: prepared, execution: e, node }
    }
    const started = Date.now()
    const outcome = await runInternal(tx, e, node, ctx, now)
    this.metrics.automationStepDuration.observe(
      { node_type: node.type },
      (Date.now() - started) / 1000,
    )
    const r = await this.record(tx, e, graph, node, outcome, now, effects, after)
    return r === 'continue' ? { continue: true } : { done: r }
  }

  /** Renders what an external node will do (reads happen in the step transaction). */
  private async prepare(
    tx: TenantTx,
    e: ExecutionRow,
    node: FlowNode,
    ctx: Context,
  ): Promise<Prepared | Outcome> {
    const ev = (text: string) => evaluateExpression(text, ctx)
    switch (node.type) {
      case 'action.send_message': {
        const target = await this.targetOf(tx, e, null)
        if ('status' in target) return target
        if (node.config.text?.trim()) {
          const text = ev(node.config.text).trim()
          if (!text) return failed('MESSAGE_EMPTY', 'The message is empty after filling in values.')
          return {
            kind: 'send',
            target,
            content: { type: 'TEXT', text: text.slice(0, 4096) },
            input: { text },
          }
        }
        const file = await tx.file.findFirst({ where: { id: node.config.mediaFileId! } })
        if (!file) return failed('FLOW_REFERENCE_MISSING', 'The attachment was deleted.')
        const type = (['IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT'] as const).find((t) =>
          MEDIA_LIMITS[t].mime.test(file.mimeType),
        )
        if (!type) return failed('FILE_TYPE_UNSUPPORTED', "This file type can't be sent.")
        const caption = node.config.caption ? ev(node.config.caption).slice(0, 1024) : undefined
        return {
          kind: 'send',
          target,
          content: { type, fileId: file.id, ...(caption && type !== 'AUDIO' ? { caption } : {}) },
          input: { fileId: file.id, caption },
        }
      }
      case 'action.send_template': {
        const template = await tx.template.findFirst({
          where: { id: node.config.templateId, deletedAt: null },
        })
        if (!template)
          return failed('FLOW_REFERENCE_MISSING', 'The template used by this step was deleted.')
        if (!template.approvedVersionId)
          return failed('TEMPLATE_NOT_APPROVED', 'The template has no approved version.', {
            templateId: template.id,
          })
        const target = await this.targetOf(tx, e, template.wabaId)
        if ('status' in target) return target
        const v = node.config.variables
        const variables: TemplateVariables = {
          body: v.body.map(ev),
          ...(v.header?.length ? { header: v.header.map(ev) } : {}),
          ...(v.buttons
            ? {
                buttons: Object.fromEntries(
                  Object.entries(v.buttons).map(([k, b]) => [k, b.map(ev)]),
                ),
              }
            : {}),
        } as TemplateVariables
        return {
          kind: 'send',
          target,
          content: { type: 'TEMPLATE', templateVersionId: template.approvedVersionId, variables },
          input: {
            templateId: template.id,
            templateVersionId: template.approvedVersionId,
            variables,
          },
        }
      }
      case 'action.webhook': {
        const url = ev(node.config.url).trim()
        const headers = Object.fromEntries(
          Object.entries(node.config.headers ?? {}).map(([k, v]) => [k, ev(v)]),
        )
        const body =
          node.config.method === 'POST' && node.config.body ? ev(node.config.body) : undefined
        return {
          kind: 'webhook',
          request: { method: node.config.method, url, headers, body },
          timeoutMs: node.config.timeoutMs,
          saveAs: node.config.saveResponseAs,
          // Secrets never reach history: header values and secret query params are redacted.
          input: {
            method: node.config.method,
            url: redactUrl(url),
            headers: redactHeaders(headers),
            ...(body !== undefined ? { body: body.slice(0, 2000) } : {}),
          },
        }
      }
      case 'action.assign_agent':
        if (!e.conversationId)
          return failed('NO_CONVERSATION', 'This contact has no conversation to assign.')
        return { kind: 'round_robin', conversationId: e.conversationId }
      case 'action.ai_reply':
        return this.prepareAi(tx, e, node)
      default:
        throw new Error(`${node.type} is not external`)
    }
  }

  /**
   * AI reply (docs/AI_ASSISTANT.md → AI reply step): which customer message to answer, the
   * 24-hour window gate (free text only inside it) and the conversation history.
   */
  private async prepareAi(
    tx: TenantTx,
    e: ExecutionRow,
    node: Extract<FlowNode, { type: 'action.ai_reply' }>,
  ): Promise<Prepared | Outcome> {
    const mode = node.config.mode
    if (!e.conversationId)
      return failed('NO_CONVERSATION', 'The AI reply step needs a WhatsApp conversation.', { mode })
    const ai = aiStateOf(e)
    if (mode === 'CONVERSATION' && ai.mode !== 'CONVERSATION')
      // Marked before the first answer, so messages arriving meanwhile are queued for this run.
      await tx.automationExecution.update({
        where: { id: e.id },
        data: {
          context: { ...(e.context as object), ai: { ...ai, mode } } as Prisma.InputJsonValue,
        },
      })
    const trigger = (e.triggerEvent as { message?: { id?: string } }).message
    const messageId = ai.pendingMessageId ?? (ai.lastHandledMessageId ? null : trigger?.id)
    if (!messageId) {
      if (ai.lastHandledMessageId)
        return {
          status: 'SUCCEEDED',
          handle: 'replied',
          input: { mode },
          output: { ended: 'SILENCE' },
        }
      return failed('AI_NO_MESSAGE', 'There is no customer message for the AI to answer.', { mode })
    }
    const [message, conversation] = await Promise.all([
      tx.message.findFirst({ where: { id: messageId } }),
      tx.conversation.findFirst({ where: { id: e.conversationId } }),
    ])
    const input = { mode, messageId }
    if (!message || !conversation)
      return failed('NO_CONVERSATION', 'The conversation or the message no longer exists.', input)
    if (!conversation.serviceWindowExpiresAt || conversation.serviceWindowExpiresAt <= new Date())
      return failed(
        'CONVERSATION_WINDOW_CLOSED',
        "The 24-hour reply window has closed, so the AI can't send a free-text reply.",
        input,
      )
    return {
      kind: 'ai',
      conversationId: conversation.id,
      messageId,
      question: textOf(message.content),
      history: await conversationHistory(
        tx,
        conversation.id,
        message.createdAt,
        this.aiConfig.historyMessages,
      ),
      mode,
      instructions: node.config.instructions ?? null,
      input,
    }
  }

  /** Where a send goes: the execution's conversation, or the contact on a suitable number. */
  private async targetOf(
    tx: TenantTx,
    e: ExecutionRow,
    wabaRowId: string | null,
  ): Promise<SendTarget | Outcome> {
    if (e.conversationId) return { conversationId: e.conversationId }
    const contact = await tx.contact.findFirst({ where: { id: e.contactId } })
    if (!contact) return failed('CONTACT_NOT_FOUND', 'The contact was deleted.')
    const phone = wabaRowId
      ? await tx.whatsAppPhoneNumber.findFirst({
          where: { wabaId: wabaRowId, status: { in: ['CONNECTED', 'FLAGGED'] } },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        })
      : null
    return { phoneE164: contact.phoneE164, ...(phone ? { phoneNumberId: phone.id } : {}) }
  }

  /** Phase 2 (outside any transaction): the external effect. Business refusals → outcomes. */
  private async external(e: ExecutionRow, node: FlowNode, p: Prepared): Promise<Outcome> {
    const seq = e.stepCount + 1
    const key = `auto:${e.id}:${seq}`
    if (p.kind === 'send') {
      const sent = await this.trySend(e, p.target, p.content, key, p.input)
      if ('status' in sent && !('id' in sent))
        return p.replyOutcome?.errorCode === 'SESSION_EXPIRED'
          ? {
              ...sent,
              terminal: 'COMPLETED',
              errorCode: 'SESSION_EXPIRED',
              output: { expired: true, sendError: sent.errorCode },
            }
          : sent
      const message = sent as { id: string; status: string }
      return {
        ...(p.replyOutcome ?? { status: 'SUCCEEDED' as const, handle: 'next' as const }),
        input: p.input,
        output: { ...p.replyOutcome?.output, messageId: message.id, status: message.status },
      }
    }
    if (p.kind === 'ai') return this.externalAi(e, p, seq, key)
    if (p.kind === 'round_robin') {
      const result = await assignRoundRobin(
        this.db,
        this.presence,
        e.tenantId,
        p.conversationId,
        this.realtime,
      )
      if (result === 'assigned' || result === 'already-assigned')
        return {
          status: 'SUCCEEDED',
          handle: 'next',
          input: { mode: 'ROUND_ROBIN' },
          output: { result },
        }
      return failed(
        result === 'nobody-online' ? 'NO_AGENT_AVAILABLE' : 'NO_CONVERSATION',
        result === 'nobody-online'
          ? 'No teammate is online to take the conversation.'
          : 'The conversation no longer exists.',
        { mode: 'ROUND_ROBIN' },
      )
    }
    try {
      const res = await safeFetch(
        {
          ...p.request,
          headers: {
            ...p.request.headers,
            'Idempotency-Key': key,
            'User-Agent': 'Fenwira-Automation/1',
          },
          timeoutMs: p.timeoutMs,
        },
        { devHosts: this.options.webhookDevHosts },
      )
      const output = {
        status: res.status,
        durationMs: res.durationMs,
        redirects: res.redirects,
        body: res.body.slice(0, 2000),
      }
      if (res.status < 200 || res.status >= 300)
        return {
          ...failed('WEBHOOK_HTTP_ERROR', `The endpoint answered ${res.status}.`, p.input),
          output,
        }
      let parsed: unknown = res.body
      try {
        parsed = JSON.parse(res.body)
      } catch {
        // Not JSON: saved as text.
      }
      return {
        status: 'SUCCEEDED',
        handle: 'next',
        input: p.input,
        output,
        ...(p.saveAs ? { vars: { [p.saveAs]: { status: res.status, body: parsed } } } : {}),
      }
    } catch (err) {
      if (err instanceof SafeFetchError) return failed(err.code, err.message, p.input)
      throw err
    }
  }

  /**
   * One send through MessagingService; business refusals become outcomes (takeover → stopped,
   * INSUFFICIENT_BALANCE → INSUFFICIENT_FUNDS, others → error path). Infrastructure errors throw
   * and are retried — the idempotency key prevents a duplicate.
   */
  private async trySend(
    e: ExecutionRow,
    target: SendTarget,
    content: SendableContent,
    key: string,
    input: Record<string, unknown>,
    aiGenerated = false,
  ): Promise<{ id: string; status: string } | Outcome> {
    try {
      return await this.messaging.send({
        tenantId: e.tenantId,
        target,
        content,
        source: 'AUTOMATION',
        idempotencyKey: key,
        ...(aiGenerated ? { aiGenerated } : {}),
      })
    } catch (err) {
      if (!(err instanceof AppError)) throw err
      if (err.code === 'AUTOMATION_BLOCKED_BY_TAKEOVER')
        return {
          status: 'SKIPPED',
          terminal: 'STOPPED_TAKEOVER',
          errorCode: err.code,
          errorDetail:
            (err.details as { automationState?: string } | undefined)?.automationState ===
            'AUTOMATION_PAUSED'
              ? 'AUTOMATION_PAUSED'
              : 'AGENT_TAKEOVER',
          input,
        }
      // P10-D1: never retried and never waits for credit.
      if (err.code === 'INSUFFICIENT_BALANCE')
        return failed('INSUFFICIENT_FUNDS', err.message, input)
      return failed(err.code, err.message, input)
    }
  }

  /**
   * AI reply, retry-safe: the answer and the step's decision are saved in ai_reply_logs under
   * (execution, seq) BEFORE anything is sent, so a retried step reads them back (no second model
   * call) and the send reuses its idempotency key (no second message).
   */
  private async externalAi(
    e: ExecutionRow,
    p: Extract<Prepared, { kind: 'ai' }>,
    seq: number,
    key: string,
  ): Promise<Outcome> {
    const answer = await this.ai.answer(e.tenantId, {
      question: p.question,
      history: p.history,
      extraInstructions: p.instructions,
      conversationId: p.conversationId,
      runId: e.id,
      stepId: String(seq),
    })
    const decision = await this.ai.decide(e.tenantId, answer, {
      conversationId: p.conversationId,
      mode: p.mode,
    })
    const output: Record<string, unknown> = {
      outcome: decision.outcome,
      replyLogId: answer.logId,
    }
    if (decision.outcome === 'ERROR')
      return {
        ...failed(
          answer.reason === 'AI_NOT_ENABLED' ? 'AI_NOT_ENABLED' : 'AI_ERROR',
          answer.reason === 'AI_NOT_ENABLED'
            ? 'AI Assistant is turned off for this workspace.'
            : "The AI couldn't answer right now.",
          p.input,
        ),
        output,
      }
    if (decision.text) {
      const sent = await this.trySend(
        e,
        { conversationId: p.conversationId },
        { type: 'TEXT', text: decision.text.slice(0, 4096) },
        key,
        p.input,
        true,
      )
      if (!('id' in sent)) return { ...sent, output }
      output.messageId = sent.id
    }
    if (decision.handoff)
      return { status: 'SUCCEEDED', handle: 'needs_human', aiHandoff: true, input: p.input, output }
    if (p.mode === 'CONVERSATION')
      return {
        status: 'SUCCEEDED',
        stay: { handledMessageId: p.messageId },
        input: p.input,
        output,
      }
    return { status: 'SUCCEEDED', handle: 'replied', input: p.input, output }
  }

  /**
   * Records a step and moves the execution on, in the caller's transaction: the next node by the
   * outcome's handle, the error edge (or FAILED) on failure, WAITING for a delay, or terminal.
   */
  private async record(
    tx: TenantTx,
    e: ExecutionRow,
    graph: FlowGraph,
    node: FlowNode,
    o: Outcome,
    now: Date,
    effects: StartEffects,
    after: Array<() => Promise<unknown> | void>,
  ): Promise<string> {
    const seq = e.stepCount + 1
    await saveReplyProperty(tx, e, node, o)
    await tx.automationExecutionStep.create({
      data: {
        tenantId: e.tenantId,
        executionId: e.id,
        seq,
        nodeId: node.id,
        nodeType: node.type,
        status: o.status,
        input: (o.input ?? {}) as Prisma.InputJsonValue,
        output: (o.output ?? {}) as Prisma.InputJsonValue,
        errorCode: o.errorCode ?? null,
        errorDetail: o.errorDetail?.slice(0, 1000) ?? null,
        startedAt: now,
        finishedAt: o.status === 'WAITING' ? null : new Date(),
      },
    })
    this.metrics.automationSteps.inc({ node_type: node.type, status: o.status })
    if (o.notify) {
      const n = o.notify
      after.push(() => this.realtime.toUser(n.userId, 'notification.created', n.notification))
    }
    const context =
      o.vars || o.reply
        ? {
            ...(e.context as object),
            ...(o.reply ? { reply: o.reply } : {}),
            vars: {
              ...((e.context as { vars?: Record<string, unknown> }).vars ?? {}),
              ...o.vars,
            },
          }
        : undefined
    const moved = await tx.automationExecution.update({
      where: { id: e.id },
      data: { stepCount: seq, ...(context ? { context: context as Prisma.InputJsonValue } : {}) },
    })
    if (o.terminal === 'STOPPED_TAKEOVER') {
      await this.terminate(
        tx,
        moved,
        'STOPPED_TAKEOVER',
        {
          code: o.errorDetail ?? 'AGENT_TAKEOVER',
          detail: 'Stopped by human takeover.',
        },
        now,
        effects,
        after,
      )
      return 'takeover'
    }
    if (o.terminal === 'COMPLETED') {
      await this.terminate(
        tx,
        moved,
        'COMPLETED',
        o.errorCode ? { code: o.errorCode } : null,
        now,
        effects,
        after,
      )
      return 'completed'
    }
    if (o.replyWait) {
      await tx.automationExecution.update({
        where: { id: e.id },
        data: { status: 'WAITING', waitUntil: o.waitUntil },
      })
      const queued = await nextReply(tx, moved)
      const delay = queued ? 0 : Math.max(0, (o.waitUntil?.getTime() ?? now.getTime()) - Date.now())
      after.push(() => enqueueExecution(this.queues, e.tenantId, e.id, seq, { delay }))
      this.changed(after, { ...moved, status: 'WAITING' })
      return 'waiting'
    }
    if (o.aiHandoff) await applyAiHandoff(tx, moved, now)
    if (o.stay) {
      // AI conversation: answer a message that arrived meanwhile now, else wait up to 24 h.
      const ai = aiStateOf(moved)
      const pending =
        ai.pendingMessageId && ai.pendingMessageId !== o.stay.handledMessageId
          ? ai.pendingMessageId
          : null
      const context = {
        ...(moved.context as object),
        ai: {
          ...ai,
          mode: 'CONVERSATION',
          lastHandledMessageId: o.stay.handledMessageId,
          pendingMessageId: pending,
        },
      } as Prisma.InputJsonValue
      if (pending) {
        await tx.automationExecution.update({ where: { id: e.id }, data: { context } })
        this.changed(after, moved)
        return 'continue'
      }
      const until = new Date(now.getTime() + AI_SILENCE_MS)
      const waiting = await tx.automationExecution.update({
        where: { id: e.id },
        data: { status: 'WAITING', waitUntil: until, context },
      })
      after.push(() =>
        enqueueExecution(this.queues, e.tenantId, e.id, seq, { delay: AI_SILENCE_MS }),
      )
      this.changed(after, waiting)
      return 'waiting'
    }
    if (o.status === 'FAILED') {
      const edge = edgeFrom(graph, node.id, 'error')
      if (!edge) {
        await this.terminate(
          tx,
          moved,
          'FAILED',
          {
            code: o.errorCode ?? 'STEP_FAILED',
            detail: o.errorDetail,
          },
          now,
          effects,
          after,
        )
        return 'failed'
      }
      await tx.automationExecution.update({
        where: { id: e.id },
        data: { currentNodeId: edge.target },
      })
      this.changed(after, moved)
      return 'continue'
    }
    const edge = edgeFrom(graph, node.id, o.handle ?? 'next')
    if (!edge) {
      await this.terminate(
        tx,
        moved,
        'COMPLETED',
        o.errorCode ? { code: o.errorCode } : null,
        now,
        effects,
        after,
      )
      return 'completed'
    }
    if (o.status === 'WAITING' && o.waitUntil) {
      await tx.automationExecution.update({
        where: { id: e.id },
        data: { status: 'WAITING', waitUntil: o.waitUntil, currentNodeId: edge.target },
      })
      const delay = Math.max(0, o.waitUntil.getTime() - Date.now())
      after.push(() => enqueueExecution(this.queues, e.tenantId, e.id, seq, { delay }))
      this.changed(after, moved)
      return 'waiting'
    }
    await tx.automationExecution.update({
      where: { id: e.id },
      data: { currentNodeId: edge.target },
    })
    this.changed(after, moved)
    return 'continue'
  }

  private async terminate(
    tx: TenantTx,
    e: ExecutionRow,
    status: 'COMPLETED' | 'FAILED' | 'STOPPED_TAKEOVER',
    error: { code?: string; detail?: string } | null,
    now: Date,
    effects: StartEffects,
    after: Array<() => Promise<unknown> | void>,
  ) {
    await finishExecution(tx, e, status, error, this.entitlements, now, effects)
    this.metrics.automationExecutions.inc({ status })
    this.logger.info(
      {
        executionId: e.id,
        flowId: e.flowId,
        versionId: e.flowVersionId,
        status,
        errorCode: error?.code,
      },
      'automation execution finished',
    )
    this.changed(after, { ...e, status })
  }

  private changed(after: Array<() => Promise<unknown> | void>, e: ExecutionRow) {
    after.push(() =>
      this.realtime.toTenant(e.tenantId, 'automation.execution.updated', {
        executionId: e.id,
        flowId: e.flowId,
        status: e.status,
      }),
    )
    // The inbox's "AI handling" badge follows AI conversation executions.
    if (e.conversationId && aiStateOf(e).mode === 'CONVERSATION') {
      const conversationId = e.conversationId
      after.push(() =>
        this.realtime.toConversation(e.tenantId, conversationId, 'conversation.updated', {
          conversationId,
        }),
      )
    }
  }

  private async graphOf(tx: TenantTx, e: ExecutionRow): Promise<FlowGraph> {
    const v = await tx.flowVersion.findFirstOrThrow({
      where: { id: e.flowVersionId },
      select: { graph: true },
    })
    return parseGraph(v.graph)
  }

  /** After commit: enqueue started executions (the next flow of a run) and push updates. */
  private async flush(
    tenantId: string,
    effects: StartEffects,
    after: Array<() => Promise<unknown> | void>,
  ) {
    for (const id of effects.enqueue) {
      await enqueueExecution(this.queues, tenantId, id, 0)
      this.metrics.automationExecutions.inc({ status: 'STARTED' })
    }
    for (const fn of after) await fn()
  }

  /**
   * X16 recovery: WAITING executions past wait_until (Redis lost the delayed job) and RUNNING ones
   * idle for 2 minutes (a worker died) get a job again. The job id carries a time bucket, so a
   * recovery job is never swallowed by a retained completed job; the row lock and the status
   * checks make duplicates harmless.
   */
  async recover(now = new Date()): Promise<number> {
    const due = await this.db.system.dueAutomationExecutions(
      now,
      new Date(now.getTime() - STALE_RUNNING_MS),
      500,
    )
    const bucket = `r${Math.floor(now.getTime() / 60_000)}`
    for (const d of due) {
      const stage = await this.db.withTenant(d.tenantId, (tx) =>
        tx.automationExecution.findFirst({
          where: { id: d.executionId },
          select: { stepCount: true },
        }),
      )
      if (stage)
        await enqueueExecution(this.queues, d.tenantId, d.executionId, stage.stepCount, {
          suffix: bucket,
        })
    }
    if (due.length) this.logger.info({ count: due.length }, 'automation executions recovered')
    return due.length
  }
}

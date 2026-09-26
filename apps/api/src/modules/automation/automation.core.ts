import {
  type Execution,
  type ExecutionStatus,
  type ExecutionStep,
  type Flow,
  type DraftGraph,
  draftGraphSchema,
  type FlowGraph,
  flowGraphSchema,
  type FlowNode,
  type FlowVersion,
  isTrigger,
  type RunEntryStatus,
  type TriggerRun,
  type TriggerType,
} from '@fenwira/contracts'
import { type Prisma, type TenantTx } from '@fenwira/database'
import { jobId, QUEUES } from '@fenwira/queue'
import { type QueueRegistry } from '../../core/queue/queue-registry'
import { type EntitlementsService } from '../entitlements'

/**
 * Shared automation primitives (docs/AUTOMATION_ENGINE.md), used by the API (webhook trigger,
 * cancel) and the worker (trigger and execute processors). Everything here runs inside the
 * caller's tenant transaction; queue work is returned as effects and done after commit.
 */

export type PlanEntry = {
  flowId: string
  flowName: string
  flowVersionId: string
  priority: number
  status: RunEntryStatus
  reason: string | null
  executionId: string | null
}

export type TriggerEvent = {
  type: TriggerType
  eventId: string
  /** trigger.message.* in expressions. */
  message?: { id: string; type: string; text: string }
  /** trigger.webhook.* in expressions (the parsed request body). */
  webhook?: unknown
  contact?: { source: string }
}

export type TakeoverReason = 'AGENT_TAKEOVER' | 'AUTOMATION_PAUSED'

export type ExecutionRow = Prisma.AutomationExecutionGetPayload<object>
type FlowRow = Prisma.FlowGetPayload<object>
type Candidate = { flow: FlowRow; versionId: string; graph: FlowGraph }

/** AE2: priority ASC, then created_at ASC, then id ASC. Pure; unit-tested. */
export function orderPlan<T extends { priority: number; createdAt: Date; id: string }>(
  flows: readonly T[],
): T[] {
  return [...flows].sort(
    (a, b) =>
      a.priority - b.priority ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
}

export function triggerNodeOf(graph: FlowGraph): FlowNode | undefined
export function triggerNodeOf(graph: DraftGraph): DraftGraph['nodes'][number] | undefined
export function triggerNodeOf(graph: { nodes: Array<{ type: FlowNode['type'] }> }) {
  return graph.nodes.find((n) => isTrigger(n.type))
}

export const parseGraph = (raw: unknown): FlowGraph => flowGraphSchema.parse(raw)

/** Keyword match per `trigger.keyword` config. Whitespace-trimmed; case-insensitive by default. */
export function keywordMatches(
  config: {
    keywords: string[]
    match: 'EXACT' | 'CONTAINS' | 'STARTS_WITH'
    caseSensitive: boolean
  },
  text: string,
): boolean {
  const norm = (s: string) => (config.caseSensitive ? s.trim() : s.trim().toLowerCase())
  const t = norm(text)
  if (!t) return false
  return config.keywords.some((k) => {
    const kw = norm(k)
    if (config.match === 'EXACT') return t === kw
    if (config.match === 'STARTS_WITH') return t.startsWith(kw)
    return t.includes(kw)
  })
}

// ------------------------------------------------------------------------------ matching

/** PUBLISHED versions of ACTIVE flows with one of these trigger types (indexed on trigger_type). */
export async function activeCandidates(
  tx: TenantTx,
  types: readonly TriggerType[],
  onlyFlowId?: string,
): Promise<Candidate[]> {
  const flows = await tx.flow.findMany({
    where: {
      status: 'ACTIVE',
      deletedAt: null,
      activeVersionId: { not: null },
      ...(onlyFlowId ? { id: onlyFlowId } : {}),
    },
  })
  if (!flows.length) return []
  const versions = await tx.flowVersion.findMany({
    where: {
      id: { in: flows.map((f) => f.activeVersionId!) },
      state: 'PUBLISHED',
      triggerType: { in: [...types] },
    },
    select: { id: true, flowId: true, graph: true },
  })
  const byFlow = new Map(versions.map((v) => [v.flowId, v]))
  return flows
    .filter((f) => byFlow.has(f.id))
    .map((f) => {
      const v = byFlow.get(f.id)!
      return { flow: f, versionId: v.id, graph: parseGraph(v.graph) }
    })
}

/** The ordered plan for one event (keyword precedence already applied by the caller). */
export function planOf(candidates: Candidate[]): PlanEntry[] {
  return orderPlan(candidates.map((c) => ({ ...c, ...c.flow }))).map((c) => ({
    flowId: c.flow.id,
    flowName: c.flow.name,
    flowVersionId: c.versionId,
    priority: c.flow.priority,
    status: 'PENDING' as const,
    reason: null,
    executionId: null,
  }))
}

// ------------------------------------------------------------------------------ trigger runs

export type StartEffects = {
  /** Executions to enqueue on automation.execute after commit. */
  enqueue: string[]
  started: number
  skipped: number
}

const lockRun = (tx: TenantTx, runId: string) =>
  tx.$queryRaw`SELECT id FROM automation_trigger_runs WHERE id = ${runId}::uuid FOR UPDATE`

export const lockExecution = (tx: TenantTx, executionId: string) =>
  tx.$queryRaw`SELECT id FROM automation_executions WHERE id = ${executionId}::uuid FOR UPDATE`

/**
 * Starts the next PENDING flow of a trigger run (AE3: one at a time). Flows that may not start
 * are recorded SKIPPED / SKIPPED_ENTITLEMENT with a reason; a conversation that is no longer
 * AUTOMATION_ACTIVE stops the run (remaining flows SKIPPED_TAKEOVER). Returns the execution to
 * enqueue, or null when the run is finished.
 */
export async function startNextFlow(
  tx: TenantTx,
  runId: string,
  entitlements: EntitlementsService,
  now: Date,
  effects: StartEffects,
): Promise<string | null> {
  const run = await tx.automationTriggerRun.findFirstOrThrow({ where: { id: runId } })
  if (run.status !== 'RUNNING') return null
  const plan = run.plan as unknown as PlanEntry[]
  const save = (data: Partial<Prisma.AutomationTriggerRunUpdateInput> = {}) =>
    tx.automationTriggerRun.update({
      where: { id: runId },
      data: { plan: plan as unknown as Prisma.InputJsonValue, ...data },
    })
  // A flow already STARTED and not finished: the run waits for it.
  if (plan.some((e) => e.status === 'STARTED')) return null
  const trigger = run
  for (const entry of plan) {
    if (entry.status !== 'PENDING') continue
    if (trigger.conversationId) {
      const conv = await tx.conversation.findFirst({
        where: { id: trigger.conversationId },
        select: { automationState: true },
      })
      if (conv && conv.automationState !== 'AUTOMATION_ACTIVE') {
        const reason: TakeoverReason =
          conv.automationState === 'AUTOMATION_PAUSED' ? 'AUTOMATION_PAUSED' : 'AGENT_TAKEOVER'
        skipRemaining(plan, reason)
        effects.skipped += 1
        await save({ status: 'STOPPED', stopReason: reason, finishedAt: now })
        return null
      }
    }
    const flow = await tx.flow.findFirst({ where: { id: entry.flowId, deletedAt: null } })
    if (!flow || flow.status !== 'ACTIVE') {
      Object.assign(entry, { status: 'SKIPPED', reason: 'FLOW_NOT_ACTIVE' })
      effects.skipped += 1
      continue
    }
    const reentry = await reentryBlock(tx, flow, trigger)
    if (reentry) {
      Object.assign(entry, { status: 'SKIPPED', reason: reentry })
      effects.skipped += 1
      continue
    }
    const allowed = await entitlements.canStartExecution(tx, trigger.tenantId, now)
    if (!allowed.allowed) {
      Object.assign(entry, { status: 'SKIPPED_ENTITLEMENT', reason: allowed.key })
      effects.skipped += 1
      continue
    }
    const version = await tx.flowVersion.findFirstOrThrow({ where: { id: entry.flowVersionId } })
    const start = triggerNodeOf(parseGraph(version.graph))
    const execution = await tx.automationExecution.create({
      data: {
        tenantId: trigger.tenantId,
        flowId: flow.id,
        flowVersionId: version.id,
        triggerRunId: runId,
        contactId: trigger.contactId,
        conversationId: trigger.conversationId,
        triggerEvent: run.triggerEvent as Prisma.InputJsonValue,
        status: 'RUNNING',
        currentNodeId: start?.id ?? null,
        context: { vars: {} },
      },
    })
    Object.assign(entry, { status: 'STARTED', executionId: execution.id })
    effects.started += 1
    effects.enqueue.push(execution.id)
    await save()
    return execution.id
  }
  await save({ status: 'COMPLETED', finishedAt: now })
  return null
}

function skipRemaining(plan: PlanEntry[], reason: TakeoverReason) {
  for (const e of plan)
    if (e.status === 'PENDING') Object.assign(e, { status: 'SKIPPED_TAKEOVER', reason })
}

/** Re-entry policy (docs/AUTOMATION_ENGINE.md → Triggering). Returns the skip reason or null. */
async function reentryBlock(
  tx: TenantTx,
  flow: FlowRow,
  t: { contactId: string; conversationId: string | null },
): Promise<string | null> {
  if (flow.reentryPolicy === 'ALWAYS') return null
  if (flow.reentryPolicy === 'ONCE_PER_CONTACT') {
    const any = await tx.automationExecution.findFirst({
      where: { flowId: flow.id, contactId: t.contactId },
      select: { id: true },
    })
    return any ? 'REENTRY_ONCE_PER_CONTACT' : null
  }
  const active = await tx.automationExecution.findFirst({
    where: {
      flowId: flow.id,
      status: { in: ['RUNNING', 'WAITING'] },
      ...(t.conversationId
        ? { conversationId: t.conversationId }
        : { conversationId: null, contactId: t.contactId }),
    },
    select: { id: true },
  })
  return active ? 'REENTRY_ACTIVE_EXECUTION' : null
}

/** Creates the run for one event and starts its first flow. Idempotent per (tenant, event id). */
export async function createTriggerRun(
  tx: TenantTx,
  input: {
    tenantId: string
    event: TriggerEvent
    contactId: string
    conversationId: string | null
    plan: PlanEntry[]
  },
  entitlements: EntitlementsService,
  now: Date,
  effects: StartEffects,
): Promise<{ runId: string; created: boolean }> {
  const existing = await tx.automationTriggerRun.findFirst({
    where: { eventId: input.event.eventId },
    select: { id: true },
  })
  if (existing) return { runId: existing.id, created: false }
  const run = await tx.automationTriggerRun.create({
    data: {
      tenantId: input.tenantId,
      eventId: input.event.eventId,
      triggerType: input.event.type,
      contactId: input.contactId,
      conversationId: input.conversationId,
      triggerEvent: input.event as unknown as Prisma.InputJsonValue,
      plan: input.plan as unknown as Prisma.InputJsonValue,
    },
  })
  await startNextFlow(tx, run.id, entitlements, now, effects)
  return { runId: run.id, created: true }
}

// ------------------------------------------------------------------------------ termination

export type TerminalStatus = Exclude<ExecutionStatus, 'RUNNING' | 'WAITING'>

/**
 * Moves an execution to a terminal state and, in the same transaction, advances its trigger run
 * (AE3): the run's entry takes the same status; STOPPED_TAKEOVER skips the remaining flows
 * (P10-D2); otherwise the next flow starts. The caller holds the execution row lock.
 */
export async function finishExecution(
  tx: TenantTx,
  execution: ExecutionRow,
  status: TerminalStatus,
  error: { code?: string; detail?: string } | null,
  entitlements: EntitlementsService,
  now: Date,
  effects: StartEffects,
): Promise<void> {
  await tx.automationExecution.update({
    where: { id: execution.id },
    data: {
      status,
      finishedAt: now,
      waitUntil: null,
      errorCode: error?.code ?? null,
      errorDetail: error?.detail?.slice(0, 1000) ?? null,
    },
  })
  if (!execution.triggerRunId) return
  await lockRun(tx, execution.triggerRunId)
  const run = await tx.automationTriggerRun.findFirst({ where: { id: execution.triggerRunId } })
  if (!run) return
  const plan = run.plan as unknown as PlanEntry[]
  const entry = plan.find((e) => e.executionId === execution.id)
  if (entry) {
    entry.status = status
    if (error?.code) entry.reason = error.code
  }
  if (status === 'STOPPED_TAKEOVER') {
    const reason = (
      error?.code === 'AUTOMATION_PAUSED' ? 'AUTOMATION_PAUSED' : 'AGENT_TAKEOVER'
    ) as TakeoverReason
    skipRemaining(plan, reason)
    await tx.automationTriggerRun.update({
      where: { id: run.id },
      data: {
        plan: plan as unknown as Prisma.InputJsonValue,
        status: 'STOPPED',
        stopReason: reason,
        finishedAt: now,
      },
    })
    return
  }
  await tx.automationTriggerRun.update({
    where: { id: run.id },
    data: { plan: plan as unknown as Prisma.InputJsonValue },
  })
  await startNextFlow(tx, run.id, entitlements, now, effects)
}

/**
 * P10-D2: the conversation left AUTOMATION_ACTIVE → every RUNNING/WAITING execution for it stops
 * now (STOPPED_TAKEOVER), with a SKIPPED step recording why. Returns the affected executions.
 */
export async function stopConversationAutomation(
  tx: TenantTx,
  conversationId: string,
  reason: TakeoverReason,
  entitlements: EntitlementsService,
  now: Date,
  effects: StartEffects,
): Promise<ExecutionRow[]> {
  const active = await tx.automationExecution.findMany({
    where: { conversationId, status: { in: ['RUNNING', 'WAITING'] } },
    orderBy: { id: 'asc' },
    select: { id: true },
  })
  const stopped: ExecutionRow[] = []
  for (const { id } of active) {
    await lockExecution(tx, id)
    const e = await tx.automationExecution.findFirstOrThrow({ where: { id } })
    if (e.status !== 'RUNNING' && e.status !== 'WAITING') continue
    await tx.automationExecutionStep.create({
      data: {
        tenantId: e.tenantId,
        executionId: e.id,
        seq: e.stepCount + 1,
        nodeId: e.currentNodeId ?? 'unknown',
        nodeType: 'takeover',
        status: 'SKIPPED',
        errorCode: 'AUTOMATION_BLOCKED_BY_TAKEOVER',
        errorDetail:
          reason === 'AGENT_TAKEOVER'
            ? 'An agent took over the conversation.'
            : 'Automation was paused for this conversation.',
        finishedAt: now,
      },
    })
    await tx.automationExecution.update({
      where: { id: e.id },
      data: { stepCount: e.stepCount + 1 },
    })
    await finishExecution(
      tx,
      e,
      'STOPPED_TAKEOVER',
      { code: reason, detail: 'Stopped by human takeover.' },
      entitlements,
      now,
      effects,
    )
    stopped.push(e)
  }
  return stopped
}

// ------------------------------------------------------------------------------ queue

export const EXECUTE_JOB = 'automation-execute'
export const RECOVER_JOB = 'automation-recover'

/** Deterministic job id per execution stage (docs/AUTOMATION_ENGINE.md → Execution semantics). */
export function enqueueExecution(
  queues: QueueRegistry,
  tenantId: string,
  executionId: string,
  stage: number,
  opts: { delay?: number; suffix?: string } = {},
) {
  return queues.get(QUEUES.automationExecute).add(
    EXECUTE_JOB,
    { tenantId, executionId },
    {
      jobId: jobId('exec', executionId, String(stage), ...(opts.suffix ? [opts.suffix] : [])),
      delay: opts.delay,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 500,
      removeOnFail: 500,
    },
  )
}

// ------------------------------------------------------------------------------ mappers

const iso = (d: Date | null) => d?.toISOString() ?? null

export function toFlow(
  f: FlowRow,
  extra: {
    triggerType: string | null
    activeVersion: number | null
    draftUpdatedAt: Date | null
    running: number
    total: number
  },
): Flow {
  return {
    id: f.id,
    name: f.name,
    description: f.description,
    status: f.status,
    priority: f.priority,
    reentryPolicy: f.reentryPolicy,
    triggerType: (extra.triggerType as TriggerType | null) ?? null,
    activeVersion: extra.activeVersion,
    draftUpdatedAt: iso(extra.draftUpdatedAt),
    hasWebhookToken: !!f.webhookTokenHash,
    executions: { running: extra.running, total: extra.total },
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  }
}

export const versionEtag = (v: { id: string; updatedAt: Date }) =>
  `"${v.id}.${v.updatedAt.getTime()}"`

export function toFlowVersion(v: Prisma.FlowVersionGetPayload<object>): FlowVersion {
  return {
    id: v.id,
    version: v.version,
    state: v.state,
    graph: draftGraphSchema.parse(v.graph),
    publishedAt: iso(v.publishedAt),
    updatedAt: v.updatedAt.toISOString(),
    etag: versionEtag(v),
    validation: (v.validationErrors as FlowVersion['validation']) ?? null,
  }
}

export function toExecution(
  e: ExecutionRow,
  version: number,
  contactName: string | null,
): Execution {
  return {
    id: e.id,
    flowId: e.flowId,
    flowVersionId: e.flowVersionId,
    flowVersion: version,
    contactId: e.contactId,
    contactName,
    conversationId: e.conversationId,
    status: e.status,
    currentNodeId: e.currentNodeId,
    waitUntil: iso(e.waitUntil),
    stepCount: e.stepCount,
    errorCode: e.errorCode,
    errorDetail: e.errorDetail,
    triggerRunId: e.triggerRunId,
    startedAt: e.startedAt.toISOString(),
    finishedAt: iso(e.finishedAt),
  }
}

/** Keys whose values are identifiers or outcomes, never customer data. */
const SAFE_KEYS = new Set([
  'templateId',
  'templateVersionId',
  'tagIds',
  'messageId',
  'status',
  'handle',
  'mode',
  'method',
  'durationMs',
  'waitUntil',
  'amount',
  'unit',
  'match',
  'result',
  'assigneeId',
  'fields',
  'redirects',
])

/** PII redaction for viewers without automations.write (docs/AUTOMATION_ENGINE.md → History). */
export function redact(value: unknown, key?: string): unknown {
  if (key && SAFE_KEYS.has(key)) return value
  if (typeof value === 'string') return value ? '•••' : value
  if (Array.isArray(value)) return value.map((v) => redact(v))
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]))
  return value
}

export function toStep(
  s: Prisma.AutomationExecutionStepGetPayload<object>,
  canSeeData: boolean,
): ExecutionStep {
  return {
    seq: s.seq,
    nodeId: s.nodeId,
    nodeType: s.nodeType,
    status: s.status,
    input: canSeeData ? s.input : redact(s.input),
    output: canSeeData ? s.output : redact(s.output),
    errorCode: s.errorCode,
    errorDetail: s.errorDetail,
    startedAt: s.startedAt.toISOString(),
    finishedAt: iso(s.finishedAt),
  }
}

export function toTriggerRun(r: Prisma.AutomationTriggerRunGetPayload<object>): TriggerRun {
  return {
    id: r.id,
    eventId: r.eventId,
    triggerType: r.triggerType,
    status: r.status,
    stopReason: r.stopReason,
    plan: r.plan as unknown as PlanEntry[],
    createdAt: r.createdAt.toISOString(),
    finishedAt: iso(r.finishedAt),
  }
}

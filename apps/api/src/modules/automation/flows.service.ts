import { decryptSecret, encryptSecret, randomToken, safeEqual, sha256 } from '@fenwira/config'
import {
  type Execution,
  type ExecutionStatus,
  type ExecutionStep,
  type Flow,
  type DraftGraph,
  type FlowNodeStats,
  type FlowValidation,
  type FlowVersion,
  getPath,
  type TriggerRun,
  type WebhookToken,
} from '@fenwira/contracts'
import { Database, type Prisma, type TenantTx } from '@fenwira/database'
import { Inject, Injectable } from '@nestjs/common'
import { createHash, createHmac } from 'node:crypto'
import { TenantDb } from '../../core/database/tenant-db'
import { AppError } from '../../core/http/app-error'
import { MetricsService } from '../../core/metrics/metrics.service'
import { normalizePhone } from '../../core/phone'
import { QueueRegistry } from '../../core/queue/queue-registry'
import { RealtimeEmitter } from '../../core/realtime/realtime-emitter'
import { AuditService } from '../audit'
import { EntitlementsService } from '../entitlements'
import { currentAuth } from '../identity'
import { currentTenant } from '../tenancy'
import {
  createTriggerRun,
  enqueueExecution,
  finishExecution,
  lockExecution,
  parseGraph,
  planOf,
  type StartEffects,
  toExecution,
  toFlow,
  toFlowVersion,
  toStep,
  toTriggerRun,
  triggerNodeOf,
  versionEtag,
} from './automation.core'
import { AUTOMATION_OPTIONS, type AutomationOptions } from './automation.options'
import { validateWithReferences } from './references'

type FlowRow = Prisma.FlowGetPayload<object>
const EMPTY_GRAPH: DraftGraph = { nodes: [], edges: [], layout: {} }

const invalidState = (message: string, status: string) =>
  new AppError('FLOW_INVALID_STATE', 409, message, { status })

/** SHA-256 of the pair as a UUID-shaped id: the same webhook Idempotency-Key → the same event. */
function eventIdFor(flowId: string, key: string): string {
  const h = createHash('sha256').update(`${flowId}:${key}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}

/**
 * Automation API (docs/API_SPEC.md → Automation): flows and their versions, publish lifecycle,
 * the inbound webhook trigger, execution history and cancel. The builder never touches running
 * executions; executions pin the version they started with.
 */
@Injectable()
export class FlowsService {
  constructor(
    @Inject(Database) private readonly db: Database,
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
    private readonly queues: QueueRegistry,
    private readonly realtime: RealtimeEmitter,
    private readonly metrics: MetricsService,
    @Inject(AUTOMATION_OPTIONS) private readonly options: AutomationOptions,
  ) {}

  // ------------------------------------------------------------------------------ flows

  list(archived = false): Promise<Flow[]> {
    return this.tenantDb.run(async (tx) => {
      const rows = await tx.flow.findMany({
        where: archived ? { status: 'ARCHIVED' } : { deletedAt: null },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        take: 500,
      })
      return this.dtos(tx, rows)
    })
  }

  get(id: string): Promise<Flow> {
    return this.tenantDb.run(async (tx) => (await this.dtos(tx, [await this.find(tx, id)]))[0]!)
  }

  create(input: {
    managedBy?: 'REPLY_STUDIO'
    name: string
    description?: string
    priority: number
    reentryPolicy: FlowRow['reentryPolicy']
  }): Promise<Flow> {
    const { tenantId } = currentTenant()
    const { userId } = currentAuth()
    return this.tenantDb.run(async (tx) => {
      const flow = await tx.flow.create({
        data: {
          tenantId,
          name: input.name,
          managedBy: input.managedBy,
          description: input.description ?? null,
          priority: input.priority,
          reentryPolicy: input.reentryPolicy,
          createdBy: userId,
        },
      })
      const draft = await tx.flowVersion.create({
        data: {
          tenantId,
          flowId: flow.id,
          version: 1,
          graph: EMPTY_GRAPH as Prisma.InputJsonValue,
        },
      })
      const updated = await tx.flow.update({
        where: { id: flow.id },
        data: { draftVersionId: draft.id },
      })
      await this.audit.write(tx, {
        action: 'automation.created',
        targetType: 'flow',
        targetId: flow.id,
        changes: { name: flow.name },
      })
      return (await this.dtos(tx, [updated]))[0]!
    })
  }

  update(
    id: string,
    patch: Partial<{
      name: string
      description: string
      priority: number
      reentryPolicy: FlowRow['reentryPolicy']
    }>,
  ): Promise<Flow> {
    return this.tenantDb.run(async (tx) => {
      const flow = await this.find(tx, id)
      if (flow.status === 'ARCHIVED')
        throw invalidState('An archived flow can’t be edited.', flow.status)
      const updated = await tx.flow.update({ where: { id }, data: patch })
      await this.audit.write(tx, {
        action: 'automation.updated',
        targetType: 'flow',
        targetId: id,
        changes: patch,
      })
      return (await this.dtos(tx, [updated]))[0]!
    })
  }

  /** Archive: no new executions; running ones finish on their pinned version. */
  remove(id: string): Promise<void> {
    return this.tenantDb.run(async (tx) => {
      await this.find(tx, id)
      await tx.flow.update({
        where: { id },
        data: {
          status: 'ARCHIVED',
          deletedAt: new Date(),
          webhookTokenHash: null,
          webhookSecretCiphertext: null,
        },
      })
      await this.audit.write(tx, {
        action: 'automation.archived',
        targetType: 'flow',
        targetId: id,
        changes: {},
      })
    })
  }

  /** Restore as paused (or draft), never silently start sending again. */
  restore(id: string): Promise<Flow> {
    return this.tenantDb.run(async (tx) => {
      await tx.$queryRaw`SELECT id FROM flows WHERE id = ${id}::uuid FOR UPDATE`
      const flow = await this.find(tx, id, true)
      if (flow.status !== 'ARCHIVED')
        throw invalidState('Only archived flows can be restored.', flow.status)
      const updated = await tx.flow.update({
        where: { id },
        data: { deletedAt: null, status: flow.activeVersionId ? 'PAUSED' : 'DRAFT' },
      })
      await this.audit.write(tx, {
        action: 'automation.restored',
        targetType: 'flow',
        targetId: id,
        changes: { status: updated.status },
      })
      return (await this.dtos(tx, [updated]))[0]!
    })
  }

  /** Detach only the current draft; published/running versions are immutable. */
  discardDraft(id: string, ifMatch: string | undefined): Promise<FlowVersion> {
    return this.tenantDb.run(async (tx) => {
      await tx.$queryRaw`SELECT id FROM flows WHERE id = ${id}::uuid FOR UPDATE`
      const flow = await this.find(tx, id)
      if (!flow.activeVersionId || !flow.draftVersionId)
        throw invalidState(
          'There are no draft changes to discard from a published flow.',
          flow.status,
        )
      const draft = await tx.flowVersion.findFirstOrThrow({ where: { id: flow.draftVersionId } })
      if (!ifMatch || ifMatch.trim() !== versionEtag(draft))
        throw new AppError(
          'VERSION_CONFLICT',
          409,
          'The draft changed. Reload before discarding.',
          { etag: versionEtag(draft) },
        )
      await tx.flow.update({ where: { id }, data: { draftVersionId: null } })
      await tx.flowVersion.update({ where: { id: draft.id }, data: { state: 'ARCHIVED' } })
      await this.audit.write(tx, {
        action: 'automation.draft.discarded',
        targetType: 'flow',
        targetId: id,
        changes: { version: draft.version },
      })
      return toFlowVersion(
        await tx.flowVersion.findFirstOrThrow({ where: { id: flow.activeVersionId } }),
      )
    })
  }

  // ------------------------------------------------------------------------------ versions

  /** The draft, or (when there is none) the active version to start editing from. */
  getDraft(id: string): Promise<FlowVersion> {
    return this.tenantDb.run(async (tx) => {
      const flow = await this.find(tx, id)
      const vid = flow.draftVersionId ?? flow.activeVersionId
      if (!vid) throw AppError.notFound('This flow has no versions.')
      return toFlowVersion(await tx.flowVersion.findFirstOrThrow({ where: { id: vid } }))
    })
  }

  /**
   * Saves the draft graph. A published version is never edited: the first save after publishing
   * creates a new DRAFT version. `If-Match` must carry the etag of what the editor loaded.
   */
  putDraft(id: string, graph: DraftGraph, ifMatch: string | undefined): Promise<FlowVersion> {
    const { tenantId } = currentTenant()
    return this.tenantDb.run(async (tx) => {
      await tx.$queryRaw`SELECT id FROM flows WHERE id = ${id}::uuid FOR UPDATE`
      const flow = await this.find(tx, id)
      if (flow.status === 'ARCHIVED')
        throw invalidState('An archived flow can’t be edited.', flow.status)
      const base = flow.draftVersionId ?? flow.activeVersionId
      const current = base ? await tx.flowVersion.findFirst({ where: { id: base } }) : null
      if (!ifMatch)
        throw AppError.validation(
          [
            {
              path: 'If-Match',
              code: 'required',
              message: 'Send the etag of the version you edited.',
            },
          ],
          'Saving a draft requires If-Match.',
        )
      if (current && ifMatch.trim() !== versionEtag(current))
        throw new AppError(
          'VERSION_CONFLICT',
          409,
          'Someone else saved this flow since you opened it. Reload to see their changes.',
          { etag: versionEtag(current) },
        )
      if (flow.managedBy === 'REPLY_STUDIO' && !graph.replyStudio)
        throw AppError.validation([
          {
            path: 'graph.replyStudio',
            code: 'required',
            message: 'Keep the Reply Studio settings with this flow.',
          },
        ])
      const trigger = triggerNodeOf(graph)
      const validation = await validateWithReferences(tx, graph)
      const data = {
        graph: graph as unknown as Prisma.InputJsonValue,
        triggerType: trigger?.type ?? null,
        triggerConfig: (trigger?.config ?? null) as Prisma.InputJsonValue,
        validationErrors: validation as unknown as Prisma.InputJsonValue,
      }
      if (flow.draftVersionId)
        return toFlowVersion(
          await tx.flowVersion.update({ where: { id: flow.draftVersionId }, data }),
        )
      const last = await tx.flowVersion.findFirst({
        where: { flowId: id },
        orderBy: { version: 'desc' },
        select: { version: true },
      })
      const draft = await tx.flowVersion.create({
        data: { tenantId, flowId: id, version: (last?.version ?? 0) + 1, ...data },
      })
      await tx.flow.update({ where: { id }, data: { draftVersionId: draft.id } })
      return toFlowVersion(draft)
    })
  }

  /** Dry run of the publish gate on the draft (or the active version). */
  validate(id: string): Promise<FlowValidation> {
    return this.tenantDb.run(async (tx) => {
      const flow = await this.find(tx, id)
      const vid = flow.draftVersionId ?? flow.activeVersionId
      if (!vid) throw AppError.notFound('This flow has no versions.')
      const v = await tx.flowVersion.findFirstOrThrow({ where: { id: vid } })
      return validateWithReferences(tx, v.graph)
    })
  }

  /** Validate → draft PUBLISHED → previous ARCHIVED → active_version_id, in one transaction. */
  publish(id: string): Promise<Flow> {
    const { tenantId } = currentTenant()
    const { userId } = currentAuth()
    return this.tenantDb.run(async (tx) => {
      await tx.$queryRaw`SELECT id FROM flows WHERE id = ${id}::uuid FOR UPDATE`
      const flow = await this.find(tx, id)
      if (flow.status === 'ARCHIVED')
        throw invalidState('An archived flow can’t be published.', flow.status)
      if (!flow.draftVersionId) throw invalidState('There are no unpublished changes.', flow.status)
      const draft = await tx.flowVersion.findFirstOrThrow({ where: { id: flow.draftVersionId } })
      const validation = await validateWithReferences(tx, draft.graph)
      if (!validation.valid) {
        await tx.flowVersion.update({
          where: { id: draft.id },
          data: { validationErrors: validation as unknown as Prisma.InputJsonValue },
        })
        throw new AppError(
          'FLOW_INVALID',
          422,
          validation.errors[0]?.message ?? 'Fix the highlighted steps before publishing.',
          { errors: validation.errors },
        )
      }
      const ent = await this.entitlements.canPublishFlow(tx, tenantId, flow.status === 'ACTIVE')
      if (!ent.allowed)
        throw new AppError('ENTITLEMENT_REQUIRED', 403, ent.message, {
          entitlement: ent.key,
          limit: ent.limit,
        })
      const now = new Date()
      if (flow.activeVersionId)
        await tx.flowVersion.update({
          where: { id: flow.activeVersionId },
          data: { state: 'ARCHIVED' },
        })
      await tx.flowVersion.update({
        where: { id: draft.id },
        data: {
          state: 'PUBLISHED',
          publishedAt: now,
          publishedBy: userId,
          validationErrors: validation as unknown as Prisma.InputJsonValue,
        },
      })
      const updated = await tx.flow.update({
        where: { id },
        data: {
          activeVersionId: draft.id,
          draftVersionId: null,
          status: flow.status === 'PAUSED' ? 'PAUSED' : 'ACTIVE',
        },
      })
      await this.audit.write(tx, {
        action: 'automation.published',
        targetType: 'flow',
        targetId: id,
        changes: { version: draft.version, previousVersionId: flow.activeVersionId },
      })
      return (await this.dtos(tx, [updated]))[0]!
    })
  }

  pause(id: string): Promise<Flow> {
    return this.transition(id, 'ACTIVE', 'PAUSED', 'automation.paused')
  }

  resume(id: string): Promise<Flow> {
    return this.transition(id, 'PAUSED', 'ACTIVE', 'automation.resumed')
  }

  private transition(
    id: string,
    from: 'ACTIVE' | 'PAUSED',
    to: 'ACTIVE' | 'PAUSED',
    action: string,
  ): Promise<Flow> {
    const { tenantId } = currentTenant()
    return this.tenantDb.run(async (tx) => {
      await tx.$queryRaw`SELECT id FROM flows WHERE id = ${id}::uuid FOR UPDATE`
      const flow = await this.find(tx, id)
      if (flow.status !== from)
        throw invalidState(
          to === 'PAUSED'
            ? 'Only an active flow can be paused.'
            : 'Only a paused flow can be resumed.',
          flow.status,
        )
      if (to === 'ACTIVE') {
        const ent = await this.entitlements.canPublishFlow(tx, tenantId, false)
        if (!ent.allowed)
          throw new AppError('ENTITLEMENT_REQUIRED', 403, ent.message, {
            entitlement: ent.key,
            limit: ent.limit,
          })
      }
      const updated = await tx.flow.update({ where: { id }, data: { status: to } })
      await this.audit.write(tx, { action, targetType: 'flow', targetId: id, changes: {} })
      return (await this.dtos(tx, [updated]))[0]!
    })
  }

  versions(id: string): Promise<FlowVersion[]> {
    return this.tenantDb.run(async (tx) => {
      await this.find(tx, id)
      const rows = await tx.flowVersion.findMany({
        where: { flowId: id },
        orderBy: { version: 'desc' },
        take: 100,
      })
      return rows.map(toFlowVersion)
    })
  }

  version(id: string, versionId: string): Promise<FlowVersion> {
    return this.tenantDb.run(async (tx) => {
      await this.find(tx, id)
      const v = await tx.flowVersion.findFirst({ where: { id: versionId, flowId: id } })
      if (!v) throw AppError.notFound('Version not found.')
      return toFlowVersion(v)
    })
  }

  /** New 256-bit token (stored hashed) and HMAC secret (encrypted); both returned once. */
  rotateWebhookToken(id: string): Promise<WebhookToken> {
    const ring = this.options.keyRing
    if (!ring) throw new Error('keyRing is required for webhook tokens')
    return this.tenantDb.run(async (tx) => {
      await this.find(tx, id)
      const token = randomToken(32)
      const secret = randomToken(32)
      await tx.flow.update({
        where: { id },
        data: {
          webhookTokenHash: sha256(token),
          webhookSecretCiphertext: encryptSecret(ring, secret),
        },
      })
      await this.audit.write(tx, {
        action: 'automation.webhook_token_rotated',
        targetType: 'flow',
        targetId: id,
        changes: {},
      })
      const base = (this.options.publicApiUrl ?? '').replace(/\/$/, '')
      return { token, secret, url: `${base}/api/v1/webhooks/automation/${token}` }
    })
  }

  // ------------------------------------------------------------------------------ history

  executions(
    flowId: string,
    q: { status?: ExecutionStatus; limit: number; cursor?: string },
  ): Promise<{ items: Execution[]; nextCursor: string | null }> {
    return this.tenantDb.run(async (tx) => {
      await this.find(tx, flowId, true)
      const rows = await tx.automationExecution.findMany({
        where: {
          flowId,
          ...(q.status ? { status: q.status } : {}),
          ...(q.cursor ? { id: { lt: q.cursor } } : {}),
        },
        orderBy: { id: 'desc' },
        take: q.limit + 1,
      })
      const more = rows.length > q.limit
      const items = rows.slice(0, q.limit)
      return {
        items: await this.executionDtos(tx, items),
        nextCursor: more ? items.at(-1)!.id : null,
      }
    })
  }

  /** Per-step entered/completed/failed counts across all of this flow's runs (by node id). */
  nodeStats(flowId: string): Promise<FlowNodeStats> {
    return this.tenantDb.run(async (tx) => {
      await this.find(tx, flowId, true)
      const rows = await tx.$queryRaw<
        Array<{ node_id: string; entered: bigint; completed: bigint; failed: bigint }>
      >`SELECT s.node_id,
               count(*) AS entered,
               count(*) FILTER (WHERE s.status = 'SUCCEEDED') AS completed,
               count(*) FILTER (WHERE s.status = 'FAILED') AS failed
          FROM automation_execution_steps s
          JOIN automation_executions e ON e.id = s.execution_id
         WHERE e.flow_id = ${flowId}::uuid
         GROUP BY s.node_id`
      return rows.map((r) => ({
        nodeId: r.node_id,
        entered: Number(r.entered),
        completed: Number(r.completed),
        failed: Number(r.failed),
      }))
    })
  }

  execution(id: string): Promise<Execution & { steps: ExecutionStep[] }> {
    const canSeeData = currentTenant().permissions.includes('automations.write')
    return this.tenantDb.run(async (tx) => {
      const e = await tx.automationExecution.findFirst({ where: { id } })
      if (!e) throw AppError.notFound('Execution not found.')
      const steps = await tx.automationExecutionStep.findMany({
        where: { executionId: id },
        orderBy: { seq: 'asc' },
      })
      const [dto] = await this.executionDtos(tx, [e])
      return { ...dto!, steps: steps.map((s) => toStep(s, canSeeData)) }
    })
  }

  triggerRun(flowId: string, runId: string): Promise<TriggerRun> {
    return this.tenantDb.run(async (tx) => {
      await this.find(tx, flowId, true)
      const run = await tx.automationTriggerRun.findFirst({ where: { id: runId } })
      const plan = (run?.plan ?? []) as Array<{ flowId: string }>
      if (!run || !plan.some((p) => p.flowId === flowId)) throw AppError.notFound('Run not found.')
      return toTriggerRun(run)
    })
  }

  /** Cancel is terminal and advances the trigger run to its next flow. */
  async cancel(id: string): Promise<Execution> {
    const { tenantId } = currentTenant()
    const effects: StartEffects = { enqueue: [], started: 0, skipped: 0 }
    const result = await this.tenantDb.run(async (tx) => {
      await lockExecution(tx, id)
      const e = await tx.automationExecution.findFirst({ where: { id } })
      if (!e) throw AppError.notFound('Execution not found.')
      if (e.status !== 'RUNNING' && e.status !== 'WAITING')
        throw invalidState('This execution has already finished.', e.status)
      await finishExecution(
        tx,
        e,
        'CANCELLED',
        { code: 'CANCELLED', detail: 'Cancelled by a teammate.' },
        this.entitlements,
        new Date(),
        effects,
      )
      await this.audit.write(tx, {
        action: 'automation.execution_cancelled',
        targetType: 'automation_execution',
        targetId: id,
        changes: { flowId: e.flowId },
      })
      const fresh = await tx.automationExecution.findFirstOrThrow({ where: { id } })
      return (await this.executionDtos(tx, [fresh]))[0]!
    })
    await this.flush(tenantId, effects)
    this.metrics.automationExecutions.inc({ status: 'CANCELLED' })
    this.realtime.toTenant(tenantId, 'automation.execution.updated', {
      executionId: id,
      flowId: result.flowId,
      status: 'CANCELLED',
    })
    return result
  }

  // ------------------------------------------------------------------------------ webhook trigger

  /**
   * POST /webhooks/automation/:token. X8 resolves the flow from the token hash; the HMAC is
   * checked with the flow's secret; the contact is found or created from the body; the run and
   * its execution are created now so the caller gets the execution id (202).
   */
  async receiveWebhook(
    token: string,
    rawBody: Buffer | undefined,
    body: unknown,
    signature: string | undefined,
    idempotencyKey: string | undefined,
  ): Promise<{ executionId: string | null; triggerRunId: string; status: string }> {
    const target = await this.db.system.resolveFlowWebhook(sha256(token))
    if (!target) throw AppError.notFound('Unknown webhook.')
    const { tenantId, flowId } = target
    const effects: StartEffects = { enqueue: [], started: 0, skipped: 0 }
    const out = await this.db.withTenant(tenantId, async (tx) => {
      const flow = await tx.flow.findFirst({ where: { id: flowId, deletedAt: null } })
      if (!flow) throw AppError.notFound('Unknown webhook.')
      if (flow.webhookSecretCiphertext && this.options.keyRing) {
        const secret = decryptSecret(this.options.keyRing, flow.webhookSecretCiphertext)
        const expected = `sha256=${createHmac('sha256', secret)
          .update(rawBody ?? Buffer.alloc(0))
          .digest('hex')}`
        const active = flow.activeVersionId
          ? await tx.flowVersion.findFirst({ where: { id: flow.activeVersionId } })
          : null
        const t = active ? triggerNodeOf(parseGraph(active.graph)) : undefined
        const required = t?.type === 'trigger.webhook' ? t.config.requireSignature : true
        if (required && (!signature || !safeEqual(signature, expected)))
          throw new AppError('UNAUTHENTICATED', 401, 'Invalid signature.')
      }
      if (flow.status !== 'ACTIVE' || !flow.activeVersionId)
        throw invalidState('This automation is not active.', flow.status)
      const version = await tx.flowVersion.findFirstOrThrow({ where: { id: flow.activeVersionId } })
      const trigger = triggerNodeOf(parseGraph(version.graph))
      if (trigger?.type !== 'trigger.webhook')
        throw invalidState('This automation does not start from a webhook.', flow.status)
      const rawPhone = getPath(body, trigger.config.contactPhonePath)
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { defaultCountry: true },
      })
      const phone = normalizePhone(
        typeof rawPhone === 'number'
          ? String(rawPhone)
          : typeof rawPhone === 'string'
            ? rawPhone
            : '',
        tenant.defaultCountry,
      )
      if (!phone.ok)
        throw new AppError(
          'INVALID_PHONE',
          422,
          `No valid phone number at "${trigger.config.contactPhonePath}".`,
        )
      let contact = await tx.contact.findFirst({
        where: { phoneE164: phone.e164, deletedAt: null },
        select: { id: true },
      })
      if (!contact) {
        contact = await tx.contact.create({
          data: { tenantId, phoneE164: phone.e164, source: 'API' },
          select: { id: true },
        })
        await tx.outboxEvent.create({
          data: {
            tenantId,
            eventType: 'contact.created',
            aggregateType: 'contact',
            aggregateId: contact.id,
            payload: { contactId: contact.id, source: 'API' },
          },
        })
      }
      const eventId = idempotencyKey ? eventIdFor(flowId, idempotencyKey) : undefined
      const run = await createTriggerRun(
        tx,
        {
          tenantId,
          event: {
            type: 'trigger.webhook',
            eventId: eventId ?? crypto.randomUUID(),
            webhook: body,
          },
          contactId: contact.id,
          conversationId: null,
          plan: planOf([{ flow, versionId: version.id, graph: parseGraph(version.graph) }]),
        },
        this.entitlements,
        new Date(),
        effects,
      )
      const fresh = await tx.automationTriggerRun.findFirstOrThrow({ where: { id: run.runId } })
      const entry = (
        fresh.plan as Array<{ status: string; executionId: string | null; reason: string | null }>
      )[0]
      return {
        triggerRunId: run.runId,
        executionId: entry?.executionId ?? null,
        status: entry?.reason ?? entry?.status ?? 'SKIPPED',
      }
    })
    await this.flush(tenantId, effects)
    this.metrics.automationTriggerRuns.inc({ result: 'webhook' })
    return out
  }

  // ------------------------------------------------------------------------------ helpers

  private async flush(tenantId: string, effects: StartEffects) {
    for (const id of effects.enqueue) {
      await enqueueExecution(this.queues, tenantId, id, 0)
      this.metrics.automationExecutions.inc({ status: 'STARTED' })
    }
  }

  private async find(tx: TenantTx, id: string, includeArchived = false): Promise<FlowRow> {
    const f = await tx.flow.findFirst({
      where: { id, ...(includeArchived ? {} : { deletedAt: null }) },
    })
    if (!f) throw AppError.notFound('Automation not found.')
    return f
  }

  private async dtos(tx: TenantTx, rows: FlowRow[]): Promise<Flow[]> {
    if (!rows.length) return []
    const ids = rows.map((r) => r.id)
    const versionIds = rows.flatMap((r) => [r.activeVersionId, r.draftVersionId]).filter(Boolean)
    const weekAgo = new Date(Date.now() - 7 * 86_400_000)
    const [versions, counts, recent] = await Promise.all([
      tx.flowVersion.findMany({
        where: { id: { in: versionIds as string[] } },
        select: {
          id: true,
          version: true,
          triggerType: true,
          triggerConfig: true,
          graph: true,
          updatedAt: true,
        },
      }),
      tx.automationExecution.groupBy({
        by: ['flowId', 'status'],
        where: { flowId: { in: ids } },
        _count: { _all: true },
      }),
      tx.automationExecution.groupBy({
        by: ['flowId'],
        where: { flowId: { in: ids }, startedAt: { gte: weekAgo } },
        _count: { _all: true },
      }),
    ])
    const v = new Map(versions.map((x) => [x.id, x]))
    const week = new Map(recent.map((c) => [c.flowId, c._count._all]))
    return rows.map((r) => {
      const active = r.activeVersionId ? v.get(r.activeVersionId) : undefined
      const draft = r.draftVersionId ? v.get(r.draftVersionId) : undefined
      const mine = counts.filter((c) => c.flowId === r.id)
      const triggerOf = (x?: { triggerType: string | null; triggerConfig: unknown }) =>
        x?.triggerType ? { type: x.triggerType, config: x.triggerConfig ?? {} } : null
      return toFlow(r, {
        replyStudioKind: (
          (draft ?? active)?.graph as
            { replyStudio?: { kind: Flow['replyStudioKind'] } } | undefined
        )?.replyStudio?.kind,
        triggerType: (draft ?? active)?.triggerType ?? null,
        trigger: triggerOf(draft ?? active),
        liveTrigger: triggerOf(active),
        activeVersion: active?.version ?? null,
        draftUpdatedAt: draft?.updatedAt ?? null,
        running: mine
          .filter((c) => c.status === 'RUNNING' || c.status === 'WAITING')
          .reduce((a, c) => a + c._count._all, 0),
        total: mine.reduce((a, c) => a + c._count._all, 0),
        last7d: week.get(r.id) ?? 0,
      })
    })
  }

  private async executionDtos(
    tx: TenantTx,
    rows: Prisma.AutomationExecutionGetPayload<object>[],
  ): Promise<Execution[]> {
    const [versions, contacts] = await Promise.all([
      tx.flowVersion.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.flowVersionId))] } },
        select: { id: true, version: true },
      }),
      tx.contact.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.contactId))] } },
        select: { id: true, name: true, waProfileName: true, phoneE164: true },
      }),
    ])
    const vmap = new Map(versions.map((v) => [v.id, v.version]))
    const cmap = new Map(contacts.map((c) => [c.id, c.name ?? c.waProfileName ?? c.phoneE164]))
    return rows.map((r) =>
      toExecution(r, vmap.get(r.flowVersionId) ?? 0, cmap.get(r.contactId) ?? null),
    )
  }
}

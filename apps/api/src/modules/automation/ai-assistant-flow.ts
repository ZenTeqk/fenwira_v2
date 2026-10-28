import { AI_ASSISTANT_TEMPLATE, type Flow } from '@fenwira/contracts'
import { type Prisma, type TenantTx } from '@fenwira/database'
import { Body, Controller, HttpCode, Injectable, Post } from '@nestjs/common'
import { TenantDb } from '../../core/database/tenant-db'
import { AppError } from '../../core/http/app-error'
import { RequirePermission } from '../../core/security/decorators'
import { loadSettings } from '../ai'
import { AuditService } from '../audit'
import { EntitlementsService } from '../entitlements'
import { currentAuth } from '../identity'
import { currentTenant } from '../tenancy'
import { toFlow } from './automation.core'
import { validateWithReferences } from './references'

export const MANAGED_BY_AI = 'AI_ASSISTANT'
/** Low priority: keyword and other flows run first (AE2 ordering). */
export const AI_FLOW_PRIORITY = 900

/** The managed flow's graph is the gallery's "AI assistant" template (contracts). */
export { AI_ASSISTANT_TEMPLATE }

/**
 * One-click "Turn on AI Assistant" (docs/AI_ASSISTANT.md → Managed flow): creates and publishes
 * the managed flow from the template once, then only resumes or pauses it. The settings row is
 * locked for the whole operation, so two clicks never create two flows.
 */
@Injectable()
export class AiAssistantFlowService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
  ) {}

  turnOn(): Promise<Flow> {
    const { tenantId } = currentTenant()
    const { userId } = currentAuth()
    return this.locked(async (tx) => {
      const existing = await this.managedFlow(tx, tenantId)
      if (existing?.status === 'ACTIVE') return this.dto(tx, existing)
      if (existing?.status === 'PAUSED') {
        const ent = await this.entitlements.canPublishFlow(tx, tenantId, false)
        if (!ent.allowed)
          throw new AppError('ENTITLEMENT_REQUIRED', 403, ent.message, { entitlement: ent.key })
        const updated = await tx.flow.update({
          where: { id: existing.id },
          data: { status: 'ACTIVE' },
        })
        await this.audit.write(tx, {
          action: 'ai.assistant_turned_on',
          targetType: 'flow',
          targetId: existing.id,
          changes: {},
        })
        return this.dto(tx, updated)
      }
      const validation = await validateWithReferences(tx, AI_ASSISTANT_TEMPLATE)
      if (!validation.valid)
        throw new AppError(
          'FLOW_INVALID',
          422,
          validation.errors[0]?.message ?? 'The AI assistant is not ready yet.',
          { errors: validation.errors },
        )
      const ent = await this.entitlements.canPublishFlow(tx, tenantId, false)
      if (!ent.allowed)
        throw new AppError('ENTITLEMENT_REQUIRED', 403, ent.message, { entitlement: ent.key })
      const now = new Date()
      const flow = await tx.flow.create({
        data: {
          tenantId,
          name: 'AI assistant',
          description: 'Managed by AI Assistant: answers customers from your knowledge sources.',
          priority: AI_FLOW_PRIORITY,
          reentryPolicy: 'AFTER_COMPLETION',
          managedBy: MANAGED_BY_AI,
          createdBy: userId,
        },
      })
      const version = await tx.flowVersion.create({
        data: {
          tenantId,
          flowId: flow.id,
          version: 1,
          graph: AI_ASSISTANT_TEMPLATE as unknown as Prisma.InputJsonValue,
          triggerType: 'trigger.message_received',
          triggerConfig: AI_ASSISTANT_TEMPLATE.nodes[0]!.config as Prisma.InputJsonValue,
          state: 'PUBLISHED',
          publishedAt: now,
          publishedBy: userId,
          validationErrors: validation as unknown as Prisma.InputJsonValue,
        },
      })
      const active = await tx.flow.update({
        where: { id: flow.id },
        data: { status: 'ACTIVE', activeVersionId: version.id },
      })
      await tx.aiSettings.update({ where: { tenantId }, data: { managedFlowId: flow.id } })
      await this.audit.write(tx, {
        action: 'ai.assistant_turned_on',
        targetType: 'flow',
        targetId: flow.id,
        changes: { created: true, priority: AI_FLOW_PRIORITY },
      })
      return this.dto(tx, active)
    })
  }

  pause(): Promise<Flow | null> {
    const { tenantId } = currentTenant()
    return this.locked(async (tx) => {
      const existing = await this.managedFlow(tx, tenantId)
      if (!existing) return null
      if (existing.status !== 'ACTIVE') return this.dto(tx, existing)
      const updated = await tx.flow.update({
        where: { id: existing.id },
        data: { status: 'PAUSED' },
      })
      await this.audit.write(tx, {
        action: 'ai.assistant_paused',
        targetType: 'flow',
        targetId: existing.id,
        changes: {},
      })
      return this.dto(tx, updated)
    })
  }

  private locked<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    const { tenantId, permissions } = currentTenant()
    // Turning it on or off publishes/pauses a flow: that needs automations.publish too.
    if (!permissions.includes('automations.publish'))
      throw new AppError('FORBIDDEN', 403, 'You need permission to publish automations.')
    return this.tenantDb.run(async (tx) => {
      await tx.$queryRaw`SELECT tenant_id FROM ai_settings WHERE tenant_id = ${tenantId}::uuid FOR UPDATE`
      const settings = await loadSettings(tx, tenantId)
      if (!settings?.enabled)
        throw new AppError('AI_NOT_ENABLED', 403, 'AI Assistant is not enabled for this workspace.')
      return fn(tx)
    })
  }

  /** The managed flow: the one in settings, else any live flow marked as managed (reuse). */
  private async managedFlow(tx: TenantTx, tenantId: string) {
    const settings = await loadSettings(tx, tenantId)
    const flow =
      (settings?.managedFlowId &&
        (await tx.flow.findFirst({
          where: { id: settings.managedFlowId, deletedAt: null, status: { not: 'ARCHIVED' } },
        }))) ||
      (await tx.flow.findFirst({
        where: { managedBy: MANAGED_BY_AI, deletedAt: null, status: { not: 'ARCHIVED' } },
        orderBy: { createdAt: 'asc' },
      }))
    if (flow && flow.id !== settings?.managedFlowId)
      await tx.aiSettings.update({ where: { tenantId }, data: { managedFlowId: flow.id } })
    if (flow?.status === 'DRAFT') return null
    return flow
  }

  private async dto(tx: TenantTx, f: Prisma.FlowGetPayload<object>): Promise<Flow> {
    const [running, total, version] = await Promise.all([
      tx.automationExecution.count({
        where: { flowId: f.id, status: { in: ['RUNNING', 'WAITING'] } },
      }),
      tx.automationExecution.count({ where: { flowId: f.id } }),
      f.activeVersionId
        ? tx.flowVersion.findFirst({ where: { id: f.activeVersionId }, select: { version: true } })
        : null,
    ])
    return toFlow(f, {
      triggerType: 'trigger.message_received',
      activeVersion: version?.version ?? null,
      draftUpdatedAt: null,
      running,
      total,
    })
  }
}

/** POST /ai/assistant/turn-on | pause — `ai.manage` (and `automations.publish`, checked above). */
@Controller('ai/assistant')
export class AiAssistantFlowController {
  constructor(private readonly flows: AiAssistantFlowService) {}

  @Post('turn-on')
  @RequirePermission('ai.manage')
  @HttpCode(200)
  async turnOn(@Body() _body: unknown) {
    return { data: await this.flows.turnOn() }
  }

  @Post('pause')
  @RequirePermission('ai.manage')
  @HttpCode(200)
  async pause(@Body() _body: unknown) {
    return { data: await this.flows.pause() }
  }
}

import {
  type AiActivationDecisionResult,
  type AiActivationStatus,
  type AiPlan,
  type ApproveAiActivationRequest,
  type PlatformAiActivationRequest,
  type RejectAiActivationRequest,
  type UpsertAiPlan,
} from '@fenwira/contracts'
import { Database, type Prisma, type TenantTx } from '@fenwira/database'
import { Inject, Injectable } from '@nestjs/common'
import { requestContext } from '../../core/context/request-context'
import { AppError } from '../../core/http/app-error'
import { AuditService } from '../audit'
import { toAiActivationRequest, toAiPlan } from './ai-activation.core'

/**
 * Operator console (/platform → AI requests, AI plans). Decisions are written in the workspace's
 * own transaction (settings, request, audit, outbox) and in platform_audit. The workspace hears
 * the outcome through `ai.activation.decided` (in-app notification + email).
 */
@Injectable()
export class AiActivationPlatformService {
  constructor(
    @Inject(Database) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async list(status: AiActivationStatus | null): Promise<PlatformAiActivationRequest[]> {
    const rows = await this.db.system.platformAiActivationRequests(this.operator(), status, 200)
    return rows.map((r) => ({
      id: r.id,
      status: r.status as AiActivationStatus,
      planId: r.plan_id,
      planName: r.plan_name,
      expectedConversations: r.expected_conversations,
      useCase: r.use_case,
      contactEmail: r.contact_email,
      contactPhone: r.contact_phone,
      decisionNote: r.decision_note,
      decidedAt: r.decided_at?.toISOString() ?? null,
      createdAt: r.created_at.toISOString(),
      workspaceId: r.tenant_id,
      workspaceName: r.workspace_name,
      includedReplies: r.included_replies,
    }))
  }

  async approve(
    workspaceId: string,
    id: string,
    input: ApproveAiActivationRequest,
  ): Promise<AiActivationDecisionResult> {
    const operatorId = await this.workspace(workspaceId)
    const alreadyEnabled = await this.db.withTenant(workspaceId, async (tx) => {
      const request = await this.open(tx, workspaceId, id)
      const settings = await tx.aiSettings.findFirst({ where: { tenantId: workspaceId } })
      const enabled = settings?.enabled ?? false
      const quota = request.plan?.includedReplies ?? input.monthlyMessageQuota
      if (!enabled && quota === undefined)
        throw AppError.validation([
          {
            path: 'monthlyMessageQuota',
            code: 'required',
            message: 'This request has no plan: set the monthly AI replies.',
          },
        ])
      if (!enabled)
        await tx.aiSettings.upsert({
          where: { tenantId: workspaceId },
          create: { tenantId: workspaceId, enabled: true, monthlyMessageQuota: quota! },
          update: { enabled: true, monthlyMessageQuota: quota! },
        })
      await tx.aiActivationRequest.update({
        where: { id },
        data: {
          status: 'APPROVED',
          decidedBy: operatorId,
          decidedAt: new Date(),
          decisionNote: input.note || null,
        },
      })
      await this.audit.write(tx, {
        tenantId: workspaceId,
        action: 'ai.activation_approved',
        targetType: 'ai_activation_request',
        targetId: id,
        changes: enabled
          ? { alreadyEnabled: true }
          : {
              before: {
                enabled: false,
                monthlyMessageQuota: settings?.monthlyMessageQuota ?? 0,
              },
              after: { enabled: true, monthlyMessageQuota: quota },
              planId: request.planId,
            },
      })
      // Approving an already-enabled workspace closes the request and changes nothing else.
      if (!enabled) await this.decided(tx, workspaceId, id)
      await this.platformAudit(tx, operatorId, workspaceId, 'platform.ai_activation_approved')
      return enabled
    })
    return { request: await this.one(workspaceId, id), alreadyEnabled }
  }

  async reject(
    workspaceId: string,
    id: string,
    input: RejectAiActivationRequest,
  ): Promise<AiActivationDecisionResult> {
    const operatorId = await this.workspace(workspaceId)
    await this.db.withTenant(workspaceId, async (tx) => {
      await this.open(tx, workspaceId, id)
      await tx.aiActivationRequest.update({
        where: { id },
        data: {
          status: 'REJECTED',
          decidedBy: operatorId,
          decidedAt: new Date(),
          decisionNote: input.note,
        },
      })
      await this.audit.write(tx, {
        tenantId: workspaceId,
        action: 'ai.activation_rejected',
        targetType: 'ai_activation_request',
        targetId: id,
        changes: { note: input.note },
      })
      await this.decided(tx, workspaceId, id)
      await this.platformAudit(tx, operatorId, workspaceId, 'platform.ai_activation_rejected')
    })
    return { request: await this.one(workspaceId, id), alreadyEnabled: false }
  }

  async plans(): Promise<AiPlan[]> {
    this.operator()
    const rows = await this.db.withGlobal((tx) =>
      tx.aiPlan.findMany({ orderBy: [{ active: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }] }),
    )
    return rows.map(toAiPlan)
  }

  async createPlan(input: UpsertAiPlan): Promise<AiPlan> {
    const operatorId = this.operator()
    return this.db.withGlobal(async (tx) => {
      const row = await tx.aiPlan.create({ data: planData(input) })
      await this.platformAudit(tx, operatorId, null, 'platform.ai_plan_created', { planId: row.id })
      return toAiPlan(row)
    })
  }

  async updatePlan(id: string, input: UpsertAiPlan): Promise<AiPlan> {
    const operatorId = this.operator()
    return this.db.withGlobal(async (tx) => {
      const found = await tx.aiPlan.findUnique({ where: { id } })
      if (!found) throw AppError.notFound('AI plan not found.')
      const row = await tx.aiPlan.update({ where: { id }, data: planData(input) })
      await this.platformAudit(tx, operatorId, null, 'platform.ai_plan_updated', {
        planId: id,
        active: row.active,
      })
      return toAiPlan(row)
    })
  }

  private async open(tx: TenantTx, workspaceId: string, id: string) {
    const request = await tx.aiActivationRequest.findFirst({
      where: { id, tenantId: workspaceId },
      include: { plan: { select: { includedReplies: true } } },
    })
    if (!request) throw AppError.notFound('Activation request not found.')
    if (request.status !== 'REQUESTED')
      throw new AppError('ALREADY_REVIEWED', 409, 'This request was already decided or cancelled.')
    return request
  }

  private decided(tx: TenantTx, workspaceId: string, id: string) {
    return tx.outboxEvent.create({
      data: {
        tenantId: workspaceId,
        eventType: 'ai.activation.decided',
        aggregateType: 'ai_activation_request',
        aggregateId: id,
        payload: { requestId: id },
      },
    })
  }

  private async one(workspaceId: string, id: string): Promise<PlatformAiActivationRequest> {
    return this.db.withTenant(workspaceId, async (tx) => {
      const row = await tx.aiActivationRequest.findFirstOrThrow({
        where: { id, tenantId: workspaceId },
        include: {
          plan: { select: { name: true, includedReplies: true } },
          tenant: { select: { name: true } },
        },
      })
      return {
        ...toAiActivationRequest(row),
        workspaceId,
        workspaceName: row.tenant.name,
        includedReplies: row.plan?.includedReplies ?? null,
      }
    })
  }

  private platformAudit(
    tx: Pick<TenantTx, 'platformAudit'>,
    operatorId: string,
    workspaceId: string | null,
    action: string,
    details?: Prisma.InputJsonObject,
  ) {
    // createMany: platform_audit's read policy forbids the RETURNING a single create needs.
    return tx.platformAudit.createMany({
      data: {
        operatorId,
        workspaceId,
        action,
        outcome: 'SUCCESS',
        correlationId: requestContext.correlationId() ?? null,
        ...(details ? { details } : {}),
      },
    })
  }

  private operator(): string {
    const operatorId = requestContext.get()?.platform?.operatorId
    if (!operatorId) throw new AppError('FORBIDDEN', 403, 'Operator session required.')
    return operatorId
  }

  private async workspace(workspaceId: string): Promise<string> {
    const operatorId = this.operator()
    const found = await this.db.system.platformWorkspaces(operatorId, workspaceId, 1)
    if (!found.some((w) => w.id === workspaceId))
      throw new AppError('TENANT_NOT_FOUND', 404, 'Workspace not found.')
    return operatorId
  }
}

const planData = (input: UpsertAiPlan) => ({
  name: input.name,
  monthlyPriceMinor: BigInt(input.monthlyPriceMinor),
  currency: input.currency,
  includedReplies: input.includedReplies,
  description: input.description || null,
  active: input.active,
  sortOrder: input.sortOrder,
})

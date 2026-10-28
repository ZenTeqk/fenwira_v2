import {
  type AiActivationRequest,
  type AiActivationState,
  type CreateAiActivationRequest,
} from '@fenwira/contracts'
import { Prisma, type TenantTx } from '@fenwira/database'
import { Injectable } from '@nestjs/common'
import { TenantDb } from '../../core/database/tenant-db'
import { AppError } from '../../core/http/app-error'
import { RateLimitService } from '../../core/security/rate-limit.service'
import { AuditService } from '../audit'
import { currentAuth } from '../identity'
import { currentTenant } from '../tenancy'
import {
  AI_ACTIVATION_LIMITS,
  assertCanRequest,
  toAiActivationRequest,
  toAiPlan,
} from './ai-activation.core'

/**
 * Customer side of AI Assistant activation (docs/AI_ASSISTANT.md → Activation requests). These
 * routes work while the assistant is off. A request and its outbox event commit together, so the
 * operators' email follows even if the worker is briefly down.
 */
@Injectable()
export class AiActivationService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly limits: RateLimitService,
  ) {}

  async state(): Promise<AiActivationState> {
    const { tenantId } = currentTenant()
    const { userId } = currentAuth()
    return this.tenantDb.run(async (tx) => {
      const [settings, plans, latest, user] = await Promise.all([
        tx.aiSettings.findFirst({ where: { tenantId }, select: { enabled: true } }),
        tx.aiPlan.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
        this.latest(tx, tenantId),
        tx.user.findUnique({ where: { id: userId }, select: { email: true } }),
      ])
      return {
        enabled: settings?.enabled ?? false,
        plans: plans.map(toAiPlan),
        request: latest ? toAiActivationRequest(latest) : null,
        contact: { email: user?.email ?? '', phone: null },
      }
    })
  }

  async request(input: CreateAiActivationRequest): Promise<AiActivationRequest> {
    const { tenantId } = currentTenant()
    const { userId } = currentAuth()
    await this.limits.consume([
      {
        bucket: 'ai-activation:tenant',
        key: tenantId,
        limit: AI_ACTIVATION_LIMITS.perWorkspacePerHour,
        windowSeconds: 3600,
      },
      {
        bucket: 'ai-activation:user',
        key: userId,
        limit: AI_ACTIVATION_LIMITS.perUserPerHour,
        windowSeconds: 3600,
      },
    ])
    try {
      return await this.tenantDb.run(async (tx) => {
        const [settings, open, plans] = await Promise.all([
          tx.aiSettings.findFirst({ where: { tenantId }, select: { enabled: true } }),
          tx.aiActivationRequest.count({ where: { tenantId, status: 'REQUESTED' } }),
          tx.aiPlan.findMany({ where: { active: true }, select: { id: true } }),
        ])
        assertCanRequest(input, {
          enabled: settings?.enabled ?? false,
          openRequest: open > 0,
          activePlanIds: plans.map((p) => p.id),
        })
        const row = await tx.aiActivationRequest.create({
          data: {
            tenantId,
            requestedBy: userId,
            planId: input.planId,
            expectedConversations: input.expectedConversations,
            useCase: input.useCase,
            contactEmail: input.contactEmail,
            contactPhone: input.contactPhone || null,
          },
          include: { plan: { select: { name: true } } },
        })
        await tx.outboxEvent.create({
          data: {
            tenantId,
            eventType: 'ai.activation.requested',
            aggregateType: 'ai_activation_request',
            aggregateId: row.id,
            payload: { requestId: row.id },
          },
        })
        await this.audit.write(tx, {
          tenantId,
          action: 'ai.activation_requested',
          targetType: 'ai_activation_request',
          targetId: row.id,
          changes: { planId: row.planId, expectedConversations: row.expectedConversations },
        })
        return toAiActivationRequest(row)
      })
    } catch (err) {
      // A concurrent submit lost the race on the one-open-request index.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
        throw new AppError(
          'AI_REQUEST_OPEN',
          409,
          'This workspace already has an activation request in review.',
        )
      throw err
    }
  }

  async cancel(id: string): Promise<AiActivationRequest> {
    const { tenantId } = currentTenant()
    return this.tenantDb.run(async (tx) => {
      const row = await tx.aiActivationRequest.findFirst({ where: { id, tenantId } })
      if (!row) throw AppError.notFound('Activation request not found.')
      if (row.status !== 'REQUESTED')
        throw new AppError('ALREADY_REVIEWED', 409, 'This request is no longer open.')
      const updated = await tx.aiActivationRequest.update({
        where: { id },
        data: { status: 'CANCELLED' },
        include: { plan: { select: { name: true } } },
      })
      await this.audit.write(tx, {
        tenantId,
        action: 'ai.activation_cancelled',
        targetType: 'ai_activation_request',
        targetId: id,
      })
      return toAiActivationRequest(updated)
    })
  }

  private latest(tx: TenantTx, tenantId: string) {
    return tx.aiActivationRequest.findFirst({
      where: { tenantId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { plan: { select: { name: true } } },
    })
  }
}

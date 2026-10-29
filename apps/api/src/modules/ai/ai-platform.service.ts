import { type PlatformAiSettings, type UpdatePlatformAiSettingsRequest } from '@fenwira/contracts'
import { Database } from '@fenwira/database'
import { Inject, Injectable } from '@nestjs/common'
import { requestContext } from '../../core/context/request-context'
import { AppError } from '../../core/http/app-error'
import { AuditService } from '../audit'
import { quotaUsed } from './ai.core'

/**
 * Operator console (/platform): turn AI Assistant on or off for a workspace and set its monthly
 * quota (customers pay by UPI, so both are manual). Every change is audited in the workspace's
 * audit log (as PLATFORM_OPERATOR) and in platform_audit. No customer content is read.
 */
@Injectable()
export class AiPlatformService {
  constructor(
    @Inject(Database) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async get(workspaceId: string): Promise<PlatformAiSettings> {
    await this.workspace(workspaceId)
    return this.db.withTenant(workspaceId, async (tx) => {
      const [settings, used, sources] = await Promise.all([
        tx.aiSettings.findFirst({ where: { tenantId: workspaceId } }),
        quotaUsed(tx, workspaceId),
        tx.aiKnowledgeSource.count({ where: { tenantId: workspaceId } }),
      ])
      return {
        enabled: settings?.enabled ?? false,
        monthlyMessageQuota: settings?.monthlyMessageQuota ?? 0,
        used,
        sources,
      }
    })
  }

  async update(
    workspaceId: string,
    input: UpdatePlatformAiSettingsRequest,
  ): Promise<PlatformAiSettings> {
    const operatorId = await this.workspace(workspaceId)
    const changes = {
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.monthlyMessageQuota !== undefined
        ? { monthlyMessageQuota: input.monthlyMessageQuota }
        : {}),
    }
    if (!Object.keys(changes).length)
      throw AppError.validation([
        { path: 'enabled', code: 'required', message: 'Change the switch or the quota.' },
      ])
    await this.db.withTenant(workspaceId, async (tx) => {
      const before = await tx.aiSettings.findFirst({ where: { tenantId: workspaceId } })
      await tx.aiSettings.upsert({
        where: { tenantId: workspaceId },
        create: { tenantId: workspaceId, ...changes },
        update: changes,
      })
      await this.audit.write(tx, {
        tenantId: workspaceId,
        action: 'ai.plan_changed',
        targetType: 'ai_settings',
        targetId: workspaceId,
        changes: {
          before: {
            enabled: before?.enabled ?? false,
            monthlyMessageQuota: before?.monthlyMessageQuota ?? 0,
          },
          after: changes,
          reason: input.reason,
        },
      })
      // createMany: platform_audit's read policy forbids the RETURNING a single create needs.
      await tx.platformAudit.createMany({
        data: {
          operatorId,
          workspaceId,
          action: 'platform.ai_settings_changed',
          outcome: 'SUCCESS',
          correlationId: requestContext.correlationId() ?? null,
        },
      })
    })
    return this.get(workspaceId)
  }

  private async workspace(workspaceId: string): Promise<string> {
    const operatorId = requestContext.get()?.platform?.operatorId
    if (!operatorId) throw new AppError('FORBIDDEN', 403, 'Operator session required.')
    const found = await this.db.system.platformWorkspaces(operatorId, workspaceId, 1)
    if (!found.some((w) => w.id === workspaceId))
      throw new AppError('TENANT_NOT_FOUND', 404, 'Workspace not found.')
    return operatorId
  }
}

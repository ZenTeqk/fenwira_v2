import {
  hasBusinessHours,
  RESPONSE_ALERT_DEFAULTS,
  type ResponseAlertSettings,
  type Role,
  roleHasPermission,
  type UpdateResponseAlertSettings,
} from '@fenwira/contracts'
import { type TenantTx } from '@fenwira/database'
import { Injectable } from '@nestjs/common'
import { TenantDb } from '../../core/database/tenant-db'
import { AppError } from '../../core/http/app-error'
import { AuditService } from '../audit'
import { salesEnabled } from '../sales'
import { currentTenant } from '../tenancy'
import { type IssueCode, ISSUE_MESSAGES, loadSchedule } from './response-alerts.core'

/**
 * Settings → Inbox → Response alerts (docs/RESPONSE_ALERTS.md → Configuration). Off until a
 * manager turns it on. Business hours and timezone are the workspace's existing settings, shown
 * here read-only. Saving clears the last issue, re-checks open episodes, and turning alerts on
 * records `enabled_at` so time that passed earlier never produces alerts.
 */
@Injectable()
export class ResponseAlertsService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<ResponseAlertSettings> {
    const { tenantId } = currentTenant()
    return this.db.run((tx) => this.dto(tx, tenantId))
  }

  async update(input: UpdateResponseAlertSettings): Promise<ResponseAlertSettings> {
    const { tenantId } = currentTenant()
    return this.db.run(async (tx) => {
      if (!(await salesEnabled(tx, tenantId)))
        throw new AppError(
          'FEATURE_NOT_ENABLED',
          403,
          'Follow-ups and sales are not turned on for this workspace.',
        )
      const before = await tx.responseAlertSettings.findUnique({ where: { tenantId } })
      const merged = {
        enabled: input.enabled ?? before?.enabled ?? false,
        unassignedMinutes:
          input.unassignedMinutes ??
          before?.unassignedMinutes ??
          RESPONSE_ALERT_DEFAULTS.unassignedMinutes,
        responseMinutes:
          input.responseMinutes ??
          before?.responseMinutes ??
          RESPONSE_ALERT_DEFAULTS.responseMinutes,
        escalationMinutes:
          input.escalationMinutes ??
          before?.escalationMinutes ??
          RESPONSE_ALERT_DEFAULTS.escalationMinutes,
        escalationUserIds: input.escalationUserIds ?? before?.escalationUserIds ?? [],
      }
      if (merged.escalationMinutes <= merged.responseMinutes)
        throw AppError.validation([
          {
            path: 'escalationMinutes',
            code: 'order',
            message: 'Escalate later than the staff-response alert.',
          },
        ])
      const ids = [...new Set(merged.escalationUserIds)]
      if (input.escalationUserIds) {
        const eligible = await this.eligible(tx)
        const bad = ids.filter((id) => !eligible.has(id))
        if (bad.length)
          throw AppError.validation([
            {
              path: 'escalationUserIds',
              code: 'not_manager',
              message: 'Escalation recipients must be active members who can assign conversations.',
            },
          ])
      }
      const turningOn = merged.enabled && !before?.enabled
      const issue: IssueCode | null =
        merged.enabled && !ids.length ? 'NO_ESCALATION_RECIPIENT' : null
      const data = {
        ...merged,
        escalationUserIds: ids,
        ...(turningOn ? { enabledAt: new Date() } : {}),
        issueCode: issue,
        issueMessage: issue ? ISSUE_MESSAGES[issue] : null,
        issueAt: issue ? new Date() : null,
      }
      await tx.responseAlertSettings.upsert({
        where: { tenantId },
        create: { tenantId, ...data },
        update: data,
      })
      // Thresholds or recipients may have changed: every open episode is checked again now.
      await tx.conversationWaitEpisode.updateMany({
        where: { endedAt: null, botHandling: false },
        data: { nextCheckAt: new Date() },
      })
      await this.audit.write(tx, {
        action: 'inbox.response_alerts_updated',
        targetType: 'workspace',
        targetId: tenantId,
        changes: {
          ...input,
          ...(before ? {} : { created: true }),
        },
      })
      return this.dto(tx, tenantId)
    })
  }

  /** Active members whose role can assign conversations (managers and up). */
  private async eligible(tx: TenantTx): Promise<Set<string>> {
    const members = await tx.membership.findMany({
      where: { status: 'ACTIVE' },
      select: { userId: true, role: true },
    })
    return new Set(
      members
        .filter((m) => roleHasPermission(m.role as Role, 'inbox.reassign'))
        .map((m) => m.userId),
    )
  }

  private async dto(tx: TenantTx, tenantId: string): Promise<ResponseAlertSettings> {
    const row = await tx.responseAlertSettings.findUnique({ where: { tenantId } })
    const { schedule, configured, timezone } = await loadSchedule(tx, tenantId)
    const issue =
      row?.issueCode && row.issueMessage && row.issueAt
        ? {
            code: row.issueCode as IssueCode,
            message: row.issueMessage,
            at: row.issueAt.toISOString(),
          }
        : row?.enabled && !hasBusinessHours(schedule)
          ? {
              code: 'NO_BUSINESS_HOURS' as const,
              message: ISSUE_MESSAGES.NO_BUSINESS_HOURS,
              at: new Date().toISOString(),
            }
          : null
    return {
      enabled: row?.enabled ?? false,
      unassignedMinutes: row?.unassignedMinutes ?? RESPONSE_ALERT_DEFAULTS.unassignedMinutes,
      responseMinutes: row?.responseMinutes ?? RESPONSE_ALERT_DEFAULTS.responseMinutes,
      escalationMinutes: row?.escalationMinutes ?? RESPONSE_ALERT_DEFAULTS.escalationMinutes,
      escalationUserIds: row?.escalationUserIds ?? [],
      businessHours: schedule,
      businessHoursConfigured: configured,
      workspaceTimezone: timezone,
      enabledAt: row?.enabledAt?.toISOString() ?? null,
      issue,
    }
  }
}

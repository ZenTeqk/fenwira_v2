import {
  businessHoursSchema,
  DEFAULT_BUSINESS_HOURS,
  replyReportsQuerySchema,
  type BusinessHours,
  type ReplyReport,
} from '@fenwira/contracts'
import { Body, Controller, Get, Put, Query } from '@nestjs/common'
import { TenantDb } from '../../core/database/tenant-db'
import { RequirePermission } from '../../core/security/decorators'
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe'
import { currentTenant } from '../tenancy'
import { AuditService } from '../audit'

@Controller('reply-studio')
export class ReplyStudioController {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
  ) {}

  @Get('business-hours')
  @RequirePermission('automations.read')
  async hours() {
    return {
      data: await this.db.run(async (tx) => {
        const t = await tx.tenant.findUniqueOrThrow({ where: { id: currentTenant().tenantId } })
        return businessHoursSchema.parse(t.businessHours ?? DEFAULT_BUSINESS_HOURS)
      }),
    }
  }

  @Put('business-hours')
  @RequirePermission('automations.write')
  async saveHours(@Body(new ZodValidationPipe(businessHoursSchema)) body: BusinessHours) {
    return {
      data: await this.db.run(async (tx) => {
        await tx.tenant.update({
          where: { id: currentTenant().tenantId },
          data: { businessHours: body },
        })
        await this.audit.write(tx, {
          action: 'automation.business_hours.updated',
          targetType: 'tenant',
          targetId: currentTenant().tenantId,
          changes: body,
        })
        return body
      }),
    }
  }

  @Get('reports')
  @RequirePermission('automations.read')
  async reports(
    @Query(new ZodValidationPipe(replyReportsQuerySchema))
    q: {
      from: string
      to: string
      flowId?: string
    },
  ): Promise<{ data: ReplyReport }> {
    return {
      data: await this.db.run(async (tx) => {
        const from = new Date(q.from),
          to = new Date(q.to),
          flowId = q.flowId ?? null
        const flows = await tx.$queryRaw<ReplyReport['flows']>`
        SELECT f.id AS "flowId", f.name,
          (SELECT v.graph->'replyStudio'->>'kind' FROM flow_versions v WHERE v.id = coalesce(f.draft_version_id,f.active_version_id)) AS kind,
          (SELECT count(DISTINCT m.id)::int FROM automation_executions x JOIN automation_execution_steps s ON s.execution_id=x.id JOIN messages m ON m.id::text=s.output->>'messageId' WHERE x.flow_id=f.id AND x.started_at >= ${from} AND x.started_at < ${to} AND m.status IN ('SENT','DELIVERED','READ')) AS sent,
          (SELECT count(DISTINCT coalesce(m.id,s.id))::int FROM automation_executions x JOIN automation_execution_steps s ON s.execution_id=x.id LEFT JOIN messages m ON m.id::text=s.output->>'messageId' WHERE x.flow_id=f.id AND x.started_at >= ${from} AND x.started_at < ${to} AND s.node_type IN ('action.send_message','action.send_template','action.question','action.options') AND (m.status='FAILED' OR s.status='FAILED') AND coalesce(m.error_code,s.error_code) IN ('CONTACT_BLOCKED','CONSENT_REQUIRED','CONVERSATION_WINDOW_CLOSED','AUTOMATION_BLOCKED_BY_TAKEOVER')) AS blocked,
          (SELECT count(DISTINCT coalesce(m.id,s.id))::int FROM automation_executions x JOIN automation_execution_steps s ON s.execution_id=x.id LEFT JOIN messages m ON m.id::text=s.output->>'messageId' WHERE x.flow_id=f.id AND x.started_at >= ${from} AND x.started_at < ${to} AND s.node_type IN ('action.send_message','action.send_template','action.question','action.options') AND (m.status='FAILED' OR s.status='FAILED') AND coalesce(m.error_code,s.error_code,'') NOT IN ('CONTACT_BLOCKED','CONSENT_REQUIRED','CONVERSATION_WINDOW_CLOSED','AUTOMATION_BLOCKED_BY_TAKEOVER')) AS "sendFailed",
          count(e.id)::int AS starts,
          count(e.id) FILTER (WHERE e.status = 'COMPLETED' AND e.error_code IS DISTINCT FROM 'SESSION_EXPIRED')::int AS completions,
          count(e.id) FILTER (WHERE EXISTS (SELECT 1 FROM automation_execution_steps s WHERE s.execution_id = e.id AND s.output->>'fallback' = 'true'))::int AS fallbacks,
          count(e.id) FILTER (WHERE EXISTS (SELECT 1 FROM automation_execution_steps s WHERE s.execution_id = e.id AND s.output->>'handover' = 'true'))::int AS handovers,
          count(e.id) FILTER (WHERE e.error_code = 'SESSION_EXPIRED')::int AS expired,
          count(e.id) FILTER (WHERE e.status = 'FAILED' OR EXISTS (
            SELECT 1 FROM automation_execution_steps s LEFT JOIN messages m ON m.id::text = s.output->>'messageId'
            WHERE s.execution_id = e.id AND (s.status = 'FAILED' OR m.status = 'FAILED')))::int AS failures
        FROM flows f LEFT JOIN automation_executions e ON e.flow_id = f.id AND e.started_at >= ${from} AND e.started_at < ${to}
        WHERE f.managed_by = 'REPLY_STUDIO' AND (${flowId}::uuid IS NULL OR f.id = ${flowId}::uuid)
        GROUP BY f.id, f.name ORDER BY f.name`
        const failures = await tx.$queryRaw<
          Array<Omit<ReplyReport['failures'][number], 'at'> & { at: Date }>
        >`
        SELECT e.id AS "executionId", e.flow_id AS "flowId", coalesce(m.error_code,s.error_code,e.error_code,'SEND_FAILED') AS code, e.conversation_id AS "conversationId", coalesce(s.node_id, e.current_node_id, 'Start') AS step,
          coalesce(m.error_detail, s.error_detail, e.error_detail, m.error_code, s.error_code, e.error_code, 'Send failed') AS reason,
          coalesce(s.started_at, e.started_at) AS at
        FROM automation_executions e JOIN flows f ON f.id = e.flow_id
        LEFT JOIN automation_execution_steps s ON s.execution_id = e.id
        LEFT JOIN messages m ON m.id::text = s.output->>'messageId'
        WHERE f.managed_by = 'REPLY_STUDIO' AND e.started_at >= ${from} AND e.started_at < ${to}
          AND (${flowId}::uuid IS NULL OR f.id = ${flowId}::uuid)
          AND (s.status = 'FAILED' OR m.status = 'FAILED' OR (e.status = 'FAILED' AND s.id IS NULL))
        ORDER BY at DESC LIMIT 100`
        const totals = {
          flowId: '',
          name: 'All flows',
          sent: 0,
          blocked: 0,
          sendFailed: 0,
          starts: 0,
          completions: 0,
          fallbacks: 0,
          handovers: 0,
          expired: 0,
          failures: 0,
        }
        for (const row of flows)
          for (const k of [
            'sent',
            'blocked',
            'sendFailed',
            'starts',
            'completions',
            'fallbacks',
            'handovers',
            'expired',
            'failures',
          ] as const)
            totals[k] += row[k] ?? 0
        return { totals, flows, failures: failures.map((f) => ({ ...f, at: f.at.toISOString() })) }
      }),
    }
  }
}

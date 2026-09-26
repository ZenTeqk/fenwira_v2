import { type Prisma, type PrismaClient } from '@prisma/client'

/** Anything that can run raw SQL: the client or an open transaction (to join its commit). */
type Executor = PrismaClient | Prisma.TransactionClient

export type ClaimedOutboxEvent = {
  id: string
  tenantId: string | null
  eventType: string
  payload: unknown
  correlationId: string | null
  attempts: number
  createdAt: Date
}

type ClaimedRow = {
  id: string
  tenant_id: string | null
  event_type: string
  payload: unknown
  correlation_id: string | null
  attempts: number
  created_at: Date
}

/**
 * Typed callers for the system.* SECURITY DEFINER functions — the only cross-tenant access
 * paths (docs/MULTI_TENANCY.md). Nothing else in the codebase runs cross-tenant SQL.
 */
export class SystemGateway {
  constructor(private readonly prisma: PrismaClient) {}

  /** X12 — platform (tenant-less) event into the outbox. Returns the event id. */
  async emitPlatformEvent(
    eventType: string,
    payload: Record<string, unknown>,
    correlationId: string | null,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const exec: Executor = tx ?? this.prisma
    const rows = await exec.$queryRaw<Array<{ id: string }>>`
      SELECT system.emit_platform_event(${eventType}, ${JSON.stringify(payload)}::jsonb, ${correlationId}) AS id`
    return rows[0]!.id
  }

  /** X3 — lease up to `batch` pending outbox events for `leaseSeconds`. */
  async claimOutboxEvents(batch: number, leaseSeconds: number): Promise<ClaimedOutboxEvent[]> {
    const rows = await this.prisma.$queryRaw<ClaimedRow[]>`
      SELECT * FROM system.claim_outbox_events(${batch}::int, ${leaseSeconds}::int)`
    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      eventType: r.event_type,
      payload: r.payload,
      correlationId: r.correlation_id,
      attempts: r.attempts,
      createdAt: r.created_at,
    }))
  }

  async markOutboxDispatched(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0
    const rows = await this.prisma.$queryRaw<Array<{ n: number }>>`
      SELECT system.mark_outbox_dispatched(${ids}::uuid[]) AS n`
    return rows[0]!.n
  }

  /** Returns 1 if the event was rescheduled (or marked FAILED), 0 if it was not PENDING. */
  async markOutboxRetry(id: string, error: string, maxAttempts: number): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ n: number }>>`
      SELECT system.mark_outbox_retry(${id}::uuid, ${error}, ${maxAttempts}::int) AS n`
    return rows[0]!.n
  }

  /** X6 — invitation token hash → IDs only (docs/MULTI_TENANCY.md). */
  async resolveInvitation(
    tokenHash: Uint8Array,
  ): Promise<{ tenantId: string; invitationId: string } | null> {
    const rows = await this.prisma.$queryRaw<Array<{ tenant_id: string; invitation_id: string }>>`
      SELECT * FROM system.resolve_invitation(${tokenHash})`
    const row = rows[0]
    return row ? { tenantId: row.tenant_id, invitationId: row.invitation_id } : null
  }

  /** X11 — is `phoneNumberId` live in a tenant other than `tenantId`? Never says which. */
  async phoneNumberOwnerExists(phoneNumberId: string, tenantId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT system.phone_number_owner_exists(${phoneNumberId}, ${tenantId}::uuid) AS exists`
    return rows[0]?.exists ?? false
  }

  /** X5 — phone numbers whose last sync is older than `olderThan` (IDs only). */
  async phoneNumbersDueForSync(
    olderThan: Date,
    limit: number,
  ): Promise<Array<{ tenantId: string; phoneId: string }>> {
    const rows = await this.prisma.$queryRaw<Array<{ tenant_id: string; phone_id: string }>>`
      SELECT * FROM system.phone_numbers_due_for_sync(${olderThan}, ${limit}::int)`
    return rows.map((r) => ({ tenantId: r.tenant_id, phoneId: r.phone_id }))
  }

  /** X14 — WABAs whose templates were not synced since `olderThan` (row IDs only). */
  async wabasDueForTemplateSync(
    olderThan: Date,
    limit: number,
  ): Promise<Array<{ tenantId: string; wabaId: string }>> {
    const rows = await this.prisma.$queryRaw<Array<{ tenant_id: string; waba_id: string }>>`
      SELECT * FROM system.wabas_due_for_template_sync(${olderThan}, ${limit}::int)`
    return rows.map((r) => ({ tenantId: r.tenant_id, wabaId: r.waba_id }))
  }

  /** X4 — SCHEDULED campaigns whose time has come (IDs only). */
  async dueScheduledCampaigns(
    now: Date,
    limit: number,
  ): Promise<Array<{ tenantId: string; campaignId: string }>> {
    const rows = await this.prisma.$queryRaw<Array<{ tenant_id: string; campaign_id: string }>>`
      SELECT * FROM system.due_scheduled_campaigns(${now}, ${limit}::int)`
    return rows.map((r) => ({ tenantId: r.tenant_id, campaignId: r.campaign_id }))
  }

  /** X15 — PREPARING/RUNNING campaigns (crash recovery and completion checks). */
  async activeCampaigns(
    limit: number,
  ): Promise<Array<{ tenantId: string; campaignId: string; status: string }>> {
    const rows = await this.prisma.$queryRaw<
      Array<{ tenant_id: string; campaign_id: string; status: string }>
    >`SELECT * FROM system.active_campaigns(${limit}::int)`
    return rows.map((r) => ({ tenantId: r.tenant_id, campaignId: r.campaign_id, status: r.status }))
  }

  /** X8 — the flow (and tenant) of an automation webhook token hash. */
  async resolveFlowWebhook(
    tokenHash: Uint8Array,
  ): Promise<{ tenantId: string; flowId: string } | null> {
    const rows = await this.prisma.$queryRaw<Array<{ tenant_id: string; flow_id: string }>>`
      SELECT * FROM system.resolve_flow_webhook(${Buffer.from(tokenHash)})`
    return rows[0] ? { tenantId: rows[0].tenant_id, flowId: rows[0].flow_id } : null
  }

  /** X16 — WAITING executions past their time, and RUNNING ones idle since `stale` (IDs only). */
  async dueAutomationExecutions(
    now: Date,
    stale: Date,
    limit: number,
  ): Promise<Array<{ tenantId: string; executionId: string }>> {
    const rows = await this.prisma.$queryRaw<Array<{ tenant_id: string; execution_id: string }>>`
      SELECT * FROM system.due_automation_executions(${now}, ${stale}, ${limit}::int)`
    return rows.map((r) => ({ tenantId: r.tenant_id, executionId: r.execution_id }))
  }

  /** X2 — tenant (and number row) of a live phone_number_id, for webhook routing. */
  async resolveTenantByPhoneNumberId(
    phoneNumberId: string,
  ): Promise<{ tenantId: string; phoneId: string } | null> {
    const rows = await this.prisma.$queryRaw<Array<{ tenant_id: string; phone_id: string }>>`
      SELECT * FROM system.resolve_tenant_by_phone_number_id(${phoneNumberId})`
    const row = rows[0]
    return row ? { tenantId: row.tenant_id, phoneId: row.phone_id } : null
  }

  /** X2 (WABA-level fields such as template and account updates). */
  async resolveTenantByWabaId(wabaId: string): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<Array<{ tenant_id: string }>>`
      SELECT * FROM system.resolve_tenant_by_waba_id(${wabaId})`
    return rows[0]?.tenant_id ?? null
  }

  /** X13 — conversations whose snooze ended or whose takeover should be released (IDs only). */
  async inboxMaintenanceDue(
    now: Date,
    limit: number,
  ): Promise<
    Array<{ tenantId: string; conversationId: string; kind: 'UNSNOOZE' | 'RELEASE_TAKEOVER' }>
  > {
    const rows = await this.prisma.$queryRaw<
      Array<{ tenant_id: string; conversation_id: string; kind: 'UNSNOOZE' | 'RELEASE_TAKEOVER' }>
    >`SELECT * FROM system.inbox_maintenance_due(${now}, ${limit}::int)`
    return rows.map((r) => ({
      tenantId: r.tenant_id,
      conversationId: r.conversation_id,
      kind: r.kind,
    }))
  }
}

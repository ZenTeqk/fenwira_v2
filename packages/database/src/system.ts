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

  /** X21: bounded workspace discovery after explicit platform authorization; no customer content. */
  async platformWorkspaces(operatorId: string, query: string, limit: number) {
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; name: string; slug: string; created_at: Date }>
    >`SELECT * FROM system.platform_workspaces(${operatorId}::uuid, ${query}, ${limit}::int)`
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      createdAt: r.created_at.toISOString(),
    }))
  }

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

  /**
   * X2 + ML-D1: where a webhook event goes and which secret must have signed it. `phoneId` is set
   * for message/status events (the number must belong to `wabaId`); `appSecretCiphertext` null
   * means the platform app secret. Null when the WABA or the number isn't live in any workspace.
   */
  async resolveWebhookRoute(
    wabaId: string,
    phoneNumberId: string | null,
  ): Promise<{
    tenantId: string
    phoneId: string | null
    appSecretCiphertext: Buffer | null
  } | null> {
    const rows = await this.prisma.$queryRaw<
      Array<{ tenant_id: string; phone_id: string | null; app_secret_ciphertext: Buffer | null }>
    >`SELECT * FROM system.resolve_webhook_route(${wabaId}, ${phoneNumberId})`
    const row = rows[0]
    return row
      ? {
          tenantId: row.tenant_id,
          phoneId: row.phone_id,
          appSecretCiphertext: row.app_secret_ciphertext,
        }
      : null
  }

  /** X22a (ADR-0027): a UTR already backs a PENDING or APPROVED proof in some workspace. */
  async utrInUse(utr: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ used: boolean }>>`
      SELECT system.utr_in_use(${utr}) AS used`
    return rows[0]?.used ?? false
  }

  /** X22b: ACTIVE subscriptions within the renewal lead time, and PAST_DUE ones (IDs only). */
  async manualBillingDue(
    now: Date,
    leadDays: number,
    limit: number,
    after: string | null = null,
  ): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ tenant_id: string }>>`
      SELECT * FROM system.manual_billing_due(${now}, ${leadDays}::int, ${limit}::int, ${after}::uuid)`
    return rows.map((r) => r.tenant_id)
  }

  /** X22c: the operator payment queue (oldest first). Requires an active platform grant. */
  async platformPendingProofs(operatorId: string, limit: number) {
    return this.prisma.$queryRaw<
      Array<{
        tenant_id: string
        workspace_name: string
        proof_id: string
        invoice_id: string
        invoice_number: string
        kind: string
        total_minor: bigint
        currency: string
        utr: string
        has_file: boolean
        submitted_at: Date
      }>
    >`SELECT * FROM system.platform_pending_proofs(${operatorId}::uuid, ${limit}::int)`
  }

  /** X22c: workspaces with overdue open invoices or a PAST_DUE / SUSPENDED subscription. */
  async platformOverdueWorkspaces(operatorId: string, now: Date) {
    return this.prisma.$queryRaw<
      Array<{
        tenant_id: string
        workspace_name: string
        subscription_status: string | null
        open_invoices: number
        open_total_minor: bigint
        oldest_due_at: Date | null
      }>
    >`SELECT * FROM system.platform_overdue_workspaces(${operatorId}::uuid, ${now})`
  }

  /** X22c: paid invoices per month (Asia/Kolkata), newest first. */
  async platformRevenueByMonth(operatorId: string, months: number) {
    return this.prisma.$queryRaw<
      Array<{ month: Date; currency: string; total_minor: bigint; payments: number }>
    >`SELECT * FROM system.platform_revenue_by_month(${operatorId}::uuid, ${months}::int)`
  }

  /** Operator plan price (launch: INR monthly); the function re-checks the operator's grant. */
  async platformSetPlanPrice(
    operatorId: string,
    planKey: string,
    currency: string,
    amountMinor: number,
  ): Promise<void> {
    await this.prisma
      .$queryRaw`SELECT system.platform_set_plan_price(${operatorId}::uuid, ${planKey}, ${currency}, ${amountMinor}::bigint)`
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

  /** X17 — ACTIVE reservations past `olderThan` whose message is final or missing (IDs only). */
  async staleReservations(
    olderThan: Date,
    limit: number,
  ): Promise<Array<{ tenantId: string; messageId: string }>> {
    const rows = await this.prisma.$queryRaw<Array<{ tenant_id: string; message_id: string }>>`
      SELECT * FROM system.stale_reservations(${olderThan}, ${limit}::int)`
    return rows.map((r) => ({ tenantId: r.tenant_id, messageId: r.message_id }))
  }

  /** X18 — wallets whose cached balance or holds differ from the ledger (IDs only). */
  async walletLedgerDrift(limit: number): Promise<Array<{ tenantId: string; walletId: string }>> {
    const rows = await this.prisma.$queryRaw<Array<{ tenant_id: string; wallet_id: string }>>`
      SELECT * FROM system.wallet_ledger_drift(${limit}::int)`
    return rows.map((r) => ({ tenantId: r.tenant_id, walletId: r.wallet_id }))
  }

  /** X10 — workspaces with pending analytics work or activity since `since` (IDs only). */
  async tenantsWithActivity(
    since: Date,
    limit: number,
    after: string | null = null,
  ): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ tenant_id: string }>>`
      SELECT * FROM system.tenants_with_activity(${since}, ${limit}::int, ${after}::uuid)`
    return rows.map((r) => r.tenant_id)
  }

  /** X9 (analytics) — purge one workspace's analytics events older than `before`. */
  async purgeAnalyticsEvents(tenantId: string, before: Date): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ n: number }>>`
      SELECT system.purge_analytics_events(${tenantId}::uuid, ${before}) AS n`
    return rows[0]?.n ?? 0
  }

  /** X7 — the key row for `prefix` (IDs, scopes and hash only; the app verifies the secret). */
  async resolveApiKey(prefix: string): Promise<{
    tenantId: string
    apiKeyId: string
    keyHash: Buffer
    scopes: string[]
    revokedAt: Date | null
    expiresAt: Date | null
  } | null> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        tenant_id: string
        api_key_id: string
        key_hash: Buffer
        scopes: string[]
        revoked_at: Date | null
        expires_at: Date | null
      }>
    >`SELECT * FROM system.resolve_api_key(${prefix})`
    const r = rows[0]
    if (!r) return null
    return {
      tenantId: r.tenant_id,
      apiKeyId: r.api_key_id,
      keyHash: r.key_hash,
      scopes: r.scopes,
      revokedAt: r.revoked_at,
      expiresAt: r.expires_at,
    }
  }

  /** X19 recovery: bounded due delivery IDs; payload/secret/state reads re-enter withTenant. */
  async webhookDeliveriesDue(now: Date, limit: number, after: string | null = null) {
    const rows = await this.prisma.$queryRaw<Array<{ tenant_id: string; delivery_id: string }>>`
      SELECT * FROM system.webhook_deliveries_due(${now}, ${limit}::int, ${after}::uuid)`
    return rows.map((r) => ({ tenantId: r.tenant_id, deliveryId: r.delivery_id }))
  }

  /** Purge one workspace's webhook delivery history older than `before` (retention, 30 days). */
  async purgeWebhookDeliveries(tenantId: string, before: Date): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ n: number }>>`
      SELECT system.purge_webhook_deliveries(${tenantId}::uuid, ${before}) AS n`
    return rows[0]?.n ?? 0
  }

  /** Which workspaces have webhook deliveries older than `before` (IDs only). */
  async tenantsWithStaleWebhookDeliveries(before: Date, limit: number): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ tenant_id: string }>>`
      SELECT * FROM system.tenants_with_stale_webhook_deliveries(${before}, ${limit}::int)`
    return rows.map((r) => r.tenant_id)
  }

  /** X20: subscriptions with lifecycle work due (Phase 11 Step 4) — tenant ids only. */
  async subscriptionsDue(now: Date, limit: number, after: string | null = null): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ tenant_id: string }>>`
      SELECT * FROM system.subscriptions_due(${now}, ${limit}::int, ${after}::uuid)`
    return rows.map((r) => r.tenant_id)
  }
}

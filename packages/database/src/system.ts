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
}

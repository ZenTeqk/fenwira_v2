import { type TenantTx } from '@fenwira/database'
import { type EventJob } from '@fenwira/queue'
import { dayIn } from './days'

/**
 * Analytics projection (docs/ANALYTICS.md). Two rules make it safe under redelivery, retries,
 * crashes and concurrent workers:
 *
 * 1. Consuming a domain event only (a) appends it once to `analytics_events`, keyed by its source
 *    event id, and (b) marks the affected day or campaign "dirty". Nothing is incremented.
 * 2. The rollup pass recomputes a dirty day or campaign from the authoritative tables and
 *    replaces its rows. Running it twice, or on a duplicate mark, gives the same numbers.
 */

export type ConsumedEvent = EventJob & { eventId: string; occurredAt: string }

export type RecordResult = 'recorded' | 'duplicate' | 'ignored'

/** Marks a workspace-local day for recomputation (idempotent; a later mark wins). */
export async function markDay(tx: TenantTx, tenantId: string, day: string): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO analytics_dirty (tenant_id, scope, key, marked_at)
    VALUES (${tenantId}::uuid, 'day', ${day}, now())
    ON CONFLICT (tenant_id, scope, key) DO UPDATE SET marked_at = now()`
}

export async function markCampaign(
  tx: TenantTx,
  tenantId: string,
  campaignId: string,
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO analytics_dirty (tenant_id, scope, key, marked_at)
    VALUES (${tenantId}::uuid, 'campaign', ${campaignId}, now())
    ON CONFLICT (tenant_id, scope, key) DO UPDATE SET marked_at = now()`
}

/**
 * Records one consumed domain event (step 1 above). Returns 'duplicate' when this source event
 * was already recorded: then nothing else happens, so a redelivery can never count twice.
 */
export async function recordEvent(
  tx: TenantTx,
  tenantId: string,
  e: ConsumedEvent,
): Promise<RecordResult> {
  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { timezone: true },
  })
  const tz = tenant.timezone
  const payload = e.payload as Record<string, string | undefined>
  let occurredAt = new Date(e.occurredAt)
  let subjectId: string | null = null
  const dims: Record<string, string> = {}
  const days = new Set<string>()
  const campaigns = new Set<string>()

  switch (e.eventType) {
    case 'message.outbound.requested':
    case 'message.inbound.received':
    case 'message.status.changed': {
      subjectId = payload.messageId ?? null
      const m = subjectId
        ? await tx.message.findFirst({
            where: { id: subjectId },
            select: { createdAt: true, campaignId: true },
          })
        : null
      if (!m) return 'ignored'
      // Message metrics are cohorted by the message's own day, so a late status updates it.
      days.add(dayIn(m.createdAt, tz))
      if (m.campaignId) campaigns.add(m.campaignId)
      if (payload.to) dims.to = payload.to
      break
    }
    case 'conversation.opened': {
      subjectId = payload.conversationId ?? null
      if (payload.messageId) {
        dims.messageId = payload.messageId
        const m = await tx.message.findFirst({
          where: { id: payload.messageId },
          select: { createdAt: true },
        })
        if (m) occurredAt = m.createdAt // the customer's message time, not processing time
      }
      days.add(dayIn(occurredAt, tz))
      break
    }
    case 'conversation.assigned':
      subjectId = payload.conversationId ?? null
      days.add(dayIn(occurredAt, tz))
      break
    case 'campaign.launched':
    case 'campaign.resumed':
    case 'campaign.completed':
      subjectId = payload.campaignId ?? null
      if (subjectId) campaigns.add(subjectId)
      break
    case 'automation.execution.finished': {
      subjectId = payload.executionId ?? null
      const x = subjectId
        ? await tx.automationExecution.findFirst({
            where: { id: subjectId },
            select: { startedAt: true },
          })
        : null
      if (!x) return 'ignored'
      days.add(dayIn(x.startedAt, tz)) // executions are cohorted by their start day
      if (payload.status) dims.status = payload.status
      break
    }
    default:
      return 'ignored'
  }

  const inserted = await tx.$queryRaw<Array<{ id: string }>>`
    INSERT INTO analytics_events
      (id, tenant_id, source_event_id, event_type, occurred_at, subject_id, dims)
    VALUES (gen_random_uuid(), ${tenantId}::uuid, ${e.eventId}::uuid, ${e.eventType},
            ${occurredAt}, ${subjectId}::uuid, ${JSON.stringify(dims)}::jsonb)
    ON CONFLICT (tenant_id, source_event_id) DO NOTHING
    RETURNING id`
  if (!inserted.length) return 'duplicate'
  for (const d of days) await markDay(tx, tenantId, d)
  for (const c of campaigns) await markCampaign(tx, tenantId, c)
  await tx.$executeRaw`
    INSERT INTO analytics_tenant_state (tenant_id, last_event_at, updated_at)
    VALUES (${tenantId}::uuid, now(), now())
    ON CONFLICT (tenant_id) DO UPDATE SET last_event_at = now(), updated_at = now()`
  return 'recorded'
}

// ------------------------------------------------------------------------------ recompute

type Row = { metric: string; dims: string; value: bigint }

/** Adds `n` to `metric` for every listed dimension key ("" = the total). */
class Acc {
  private readonly m = new Map<string, bigint>()
  add(metric: string, keys: Array<string | null>, n: bigint) {
    if (n === 0n) return
    for (const k of keys) {
      if (k === null) continue
      const id = `${metric}\u0000${k}`
      this.m.set(id, (this.m.get(id) ?? 0n) + n)
    }
  }
  rows(): Row[] {
    return [...this.m].map(([id, value]) => {
      const [metric, dims] = id.split('\u0000') as [string, string]
      return { metric, dims, value }
    })
  }
}

const SENT = ['SENT', 'DELIVERED', 'READ']
const DELIVERED = ['DELIVERED', 'READ']
const PENDING = ['CREATED', 'QUEUED', 'SENDING']

/**
 * Recomputes every non-campaign metric of one workspace-local day from the source tables and
 * replaces that day's rows. Returns how many rows changed (0 when the projection was already
 * right; the nightly heal reports non-zero values as reconciliation corrections).
 */
export async function recomputeDay(
  tx: TenantTx,
  tenantId: string,
  day: string,
  tz: string,
): Promise<number> {
  const acc = new Acc()
  // Local midnight to local midnight, computed by Postgres (DST-safe).
  const range = await tx.$queryRaw<Array<{ start: Date; end: Date }>>`
    SELECT (${day}::date::timestamp AT TIME ZONE ${tz}) AS start,
           ((${day}::date + 1)::timestamp AT TIME ZONE ${tz}) AS "end"`
  const { start, end } = range[0]!

  // Messages, cohorted by created_at (the day the message was accepted or received).
  const messages = await tx.$queryRaw<
    Array<{
      direction: string
      source: string
      status: string
      category: string | null
      phone: string
      error: string | null
      n: bigint
    }>
  >`
    SELECT m.direction::text AS direction, m.source::text AS source, m.status::text AS status,
           t.category::text AS category, c.phone_number_id::text AS phone,
           m.error_code AS error, count(*)::bigint AS n
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    LEFT JOIN template_versions tv ON tv.id = m.template_version_id
    LEFT JOIN templates t ON t.id = tv.template_id
    WHERE m.tenant_id = ${tenantId}::uuid AND m.created_at >= ${start} AND m.created_at < ${end}
      AND m.direction IN ('INBOUND', 'OUTBOUND')
    GROUP BY 1, 2, 3, 4, 5, 6`
  for (const r of messages) {
    if (r.direction === 'INBOUND') {
      acc.add('msg.in', ['', `phone:${r.phone}`], r.n)
      continue
    }
    const keys = [
      '',
      `category:${r.category ?? 'SERVICE'}`,
      `source:${r.source}`,
      `phone:${r.phone}`,
    ]
    acc.add('msg.out.accepted', keys, r.n)
    if (SENT.includes(r.status)) acc.add('msg.out.sent', keys, r.n)
    if (DELIVERED.includes(r.status)) acc.add('msg.out.delivered', keys, r.n)
    if (r.status === 'READ') acc.add('msg.out.read', keys, r.n)
    if (PENDING.includes(r.status)) acc.add('msg.out.pending', keys, r.n)
    if (r.status === 'FAILED')
      acc.add('msg.out.failed', [...keys, `error:${r.error ?? 'UNKNOWN'}`], r.n)
  }

  // Conversations: new threads, customer opens (analytics events), agent resolutions and
  // assignments (SYSTEM events in the message history).
  const [newConversations] = await tx.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n FROM conversations
    WHERE tenant_id = ${tenantId}::uuid AND created_at >= ${start} AND created_at < ${end}`
  acc.add('conv.new', [''], newConversations!.n)
  const [opened] = await tx.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n FROM analytics_events
    WHERE tenant_id = ${tenantId}::uuid AND event_type = 'conversation.opened'
      AND occurred_at >= ${start} AND occurred_at < ${end}`
  acc.add('conv.opened', [''], opened!.n)
  const system = await tx.$queryRaw<
    Array<{ event: string; target: string | null; actor: string | null; n: bigint }>
  >`
    SELECT m.content->>'event' AS event, m.content->'data'->>'to' AS target,
           m.content->'data'->>'actorId' AS actor, count(*)::bigint AS n
    FROM messages m
    WHERE m.tenant_id = ${tenantId}::uuid AND m.created_at >= ${start} AND m.created_at < ${end}
      AND m.direction = 'SYSTEM' AND m.content->>'event' IN ('status_changed', 'assigned')
    GROUP BY 1, 2, 3`
  for (const r of system) {
    if (r.event === 'status_changed' && r.target === 'RESOLVED')
      acc.add('conv.resolved', ['', r.actor ? `agent:${r.actor}` : null], r.n)
    if (r.event === 'assigned' && r.target) acc.add('conv.assigned', ['', `agent:${r.target}`], r.n)
  }

  // Automations, cohorted by the execution's start day.
  const executions = await tx.$queryRaw<
    Array<{ flow: string; status: string; n: bigint; finished: bigint; ms: bigint }>
  >`
    SELECT flow_id::text AS flow, status::text AS status, count(*)::bigint AS n,
           count(finished_at)::bigint AS finished,
           COALESCE(sum((extract(epoch FROM finished_at - started_at) * 1000)::bigint), 0)::bigint AS ms
    FROM automation_executions
    WHERE tenant_id = ${tenantId}::uuid AND started_at >= ${start} AND started_at < ${end}
    GROUP BY 1, 2`
  for (const r of executions) {
    const keys = ['', `flow:${r.flow}`]
    acc.add('auto.started', keys, r.n)
    const outcome: Record<string, string> = {
      COMPLETED: 'auto.completed',
      FAILED: 'auto.failed',
      CANCELLED: 'auto.cancelled',
      STOPPED_TAKEOVER: 'auto.stopped_takeover',
      RUNNING: 'auto.in_progress',
      WAITING: 'auto.in_progress',
    }
    if (outcome[r.status]) acc.add(outcome[r.status]!, keys, r.n)
    acc.add('auto.finished', keys, r.finished)
    acc.add('auto.duration_ms', keys, r.ms)
  }
  const steps = await tx.$queryRaw<Array<{ node: string; n: bigint }>>`
    SELECT node_type AS node, count(*)::bigint AS n FROM automation_execution_steps
    WHERE tenant_id = ${tenantId}::uuid AND started_at >= ${start} AND started_at < ${end}
      AND status = 'FAILED'
    GROUP BY 1`
  for (const r of steps) acc.add('auto.step_failed', ['', `node:${r.node}`], r.n)

  // Usage (the source of charges) and promotional credits (the ledger).
  const usage = await tx.$queryRaw<
    Array<{ category: string; currency: string; qty: bigint; amount: bigint; cost: bigint }>
  >`
    SELECT category, currency, sum(quantity)::bigint AS qty, sum(amount_minor)::bigint AS amount,
           COALESCE(sum(provider_cost_minor), 0)::bigint AS cost
    FROM usage_events
    WHERE tenant_id = ${tenantId}::uuid AND occurred_at >= ${start} AND occurred_at < ${end}
    GROUP BY 1, 2`
  for (const r of usage) {
    acc.add('usage.messages', ['', `category:${r.category}`], r.qty)
    const cur = `cur:${r.currency}`
    acc.add('usage.charge_minor', [cur, `${cur}|category:${r.category}`], r.amount)
    // Provider cost is kept for operator reporting; workspaces don't see it (P11-Q25 interim).
    acc.add('usage.provider_cost_minor', [cur, `${cur}|category:${r.category}`], r.cost)
  }
  const promo = await tx.$queryRaw<Array<{ currency: string; amount: bigint }>>`
    SELECT w.currency, sum(t.amount_minor)::bigint AS amount
    FROM wallet_transactions t JOIN wallets w ON w.id = t.wallet_id
    WHERE t.tenant_id = ${tenantId}::uuid AND t.created_at >= ${start} AND t.created_at < ${end}
      AND t.fund_type = 'PROMOTIONAL' AND t.amount_minor > 0
    GROUP BY 1`
  for (const r of promo) acc.add('usage.promo_credit_minor', [`cur:${r.currency}`], r.amount)

  return replaceRows(tx, tenantId, day, acc.rows(), 'day')
}

/** Recomputes one campaign from campaign_recipients (authoritative) on its start day. */
export async function recomputeCampaign(
  tx: TenantTx,
  tenantId: string,
  campaignId: string,
  tz: string,
): Promise<number> {
  const c = await tx.campaign.findFirst({
    where: { id: campaignId },
    select: { startedAt: true, launchedAt: true, deletedAt: true, status: true },
  })
  const started = c && !c.deletedAt && c.status !== 'DRAFT' ? (c.startedAt ?? c.launchedAt) : null
  const key = `campaign:${campaignId}`
  if (!started) {
    const removed = await tx.$executeRaw`
      DELETE FROM analytics_daily_rollups
      WHERE tenant_id = ${tenantId}::uuid AND metric LIKE 'cmp.%'
        AND (dims_key = ${key} OR dims_key LIKE ${`${key}|%`})`
    return removed
  }
  const acc = new Acc()
  const rows = await tx.$queryRaw<Array<{ status: string; skip: string | null; n: bigint }>>`
    SELECT status::text AS status, skip_reason AS skip, count(*)::bigint AS n
    FROM campaign_recipients WHERE campaign_id = ${campaignId}::uuid
    GROUP BY 1, 2`
  for (const r of rows) {
    acc.add('cmp.recipients', [key], r.n)
    if (SENT.includes(r.status)) acc.add('cmp.sent', [key], r.n)
    if (DELIVERED.includes(r.status)) acc.add('cmp.delivered', [key], r.n)
    if (r.status === 'READ') acc.add('cmp.read', [key], r.n)
    if (r.status === 'FAILED') acc.add('cmp.failed', [key], r.n)
    if (r.status === 'SKIPPED')
      acc.add('cmp.skipped', [key, `${key}|skip:${r.skip ?? 'UNKNOWN'}`], r.n)
    if (['PENDING', 'QUEUED', 'SENDING'].includes(r.status)) acc.add('cmp.in_progress', [key], r.n)
  }
  // The start day can move (a scheduled campaign starts later), so the old rows go first.
  await tx.$executeRaw`
    DELETE FROM analytics_daily_rollups
    WHERE tenant_id = ${tenantId}::uuid AND metric LIKE 'cmp.%'
      AND (dims_key = ${key} OR dims_key LIKE ${`${key}|%`})
      AND day <> ${dayIn(started, tz)}::date`
  return replaceRows(tx, tenantId, dayIn(started, tz), acc.rows(), 'campaign', key)
}

/**
 * Replaces the rows of one day (all non-campaign metrics) or of one campaign, and returns how
 * many rows were added, removed or changed.
 */
async function replaceRows(
  tx: TenantTx,
  tenantId: string,
  day: string,
  rows: Row[],
  scope: 'day' | 'campaign',
  campaignKey?: string,
): Promise<number> {
  const existing =
    scope === 'day'
      ? await tx.$queryRaw<Row[]>`
          SELECT metric, dims_key AS dims, value FROM analytics_daily_rollups
          WHERE tenant_id = ${tenantId}::uuid AND day = ${day}::date AND metric NOT LIKE 'cmp.%'`
      : await tx.$queryRaw<Row[]>`
          SELECT metric, dims_key AS dims, value FROM analytics_daily_rollups
          WHERE tenant_id = ${tenantId}::uuid AND day = ${day}::date AND metric LIKE 'cmp.%'
            AND (dims_key = ${campaignKey} OR dims_key LIKE ${`${campaignKey}|%`})`
  const before = new Map(existing.map((r) => [`${r.metric}\u0000${r.dims}`, r.value]))
  let changed = 0
  for (const r of rows) {
    const id = `${r.metric}\u0000${r.dims}`
    if (before.get(id) !== r.value) changed++
    before.delete(id)
  }
  changed += before.size
  if (changed === 0) return 0
  if (scope === 'day')
    await tx.$executeRaw`
      DELETE FROM analytics_daily_rollups
      WHERE tenant_id = ${tenantId}::uuid AND day = ${day}::date AND metric NOT LIKE 'cmp.%'`
  else
    await tx.$executeRaw`
      DELETE FROM analytics_daily_rollups
      WHERE tenant_id = ${tenantId}::uuid AND day = ${day}::date AND metric LIKE 'cmp.%'
        AND (dims_key = ${campaignKey} OR dims_key LIKE ${`${campaignKey}|%`})`
  if (rows.length)
    await tx.$executeRaw`
      INSERT INTO analytics_daily_rollups (tenant_id, day, metric, dims_key, value, updated_at)
      SELECT ${tenantId}::uuid, ${day}::date, r.metric, r.dims, r.value, now()
      FROM unnest(${rows.map((r) => r.metric)}::text[], ${rows.map((r) => r.dims)}::text[],
                  ${rows.map((r) => r.value.toString())}::bigint[]) AS r(metric, dims, value)`
  return changed
}

/**
 * Conversation episodes (docs/ANALYTICS.md → Inbox): one per recorded conversation.opened.
 * Creates missing episodes for opens recorded since `since`, then fills the first human reply
 * and the resolution of episodes still missing either, opened within `pendingSince`. Everything
 * is derived from analytics_events and the message history, so it can be recomputed.
 */
export async function refreshEpisodes(
  tx: TenantTx,
  tenantId: string,
  tz: string,
  since: Date,
  pendingSince: Date,
): Promise<number> {
  await tx.$executeRaw`
    INSERT INTO analytics_conversation_episodes
      (id, tenant_id, conversation_id, opened_at, day, updated_at)
    SELECT e.source_event_id, e.tenant_id, e.subject_id, e.occurred_at,
           (e.occurred_at AT TIME ZONE ${tz})::date, now()
    FROM analytics_events e
    WHERE e.tenant_id = ${tenantId}::uuid AND e.event_type = 'conversation.opened'
      AND e.recorded_at >= ${since} AND e.subject_id IS NOT NULL
    ON CONFLICT (id) DO NOTHING`
  return tx.$executeRaw`
    UPDATE analytics_conversation_episodes ep
    SET first_response_at = fr.created_at, first_responder_id = fr.sent_by_user_id,
        resolved_at = rs.created_at, resolved_by = rs.actor, updated_at = now()
    FROM analytics_conversation_episodes e
    LEFT JOIN LATERAL (
      SELECT n.opened_at AS next FROM analytics_conversation_episodes n
      WHERE n.tenant_id = e.tenant_id AND n.conversation_id = e.conversation_id
        AND n.opened_at > e.opened_at
      ORDER BY n.opened_at LIMIT 1) nx ON true
    LEFT JOIN LATERAL (
      SELECT m.created_at, m.sent_by_user_id FROM messages m
      WHERE m.tenant_id = e.tenant_id AND m.conversation_id = e.conversation_id
        AND m.direction = 'OUTBOUND' AND m.source = 'INBOX' AND m.created_at >= e.opened_at
        AND (nx.next IS NULL OR m.created_at < nx.next)
      ORDER BY m.created_at LIMIT 1) fr ON true
    LEFT JOIN LATERAL (
      SELECT m.created_at, NULLIF(m.content->'data'->>'actorId', '')::uuid AS actor
      FROM messages m
      WHERE m.tenant_id = e.tenant_id AND m.conversation_id = e.conversation_id
        AND m.direction = 'SYSTEM' AND m.content->>'event' = 'status_changed'
        AND m.content->'data'->>'to' = 'RESOLVED' AND m.created_at >= e.opened_at
        AND (nx.next IS NULL OR m.created_at < nx.next)
      ORDER BY m.created_at LIMIT 1) rs ON true
    WHERE ep.id = e.id AND e.tenant_id = ${tenantId}::uuid AND e.opened_at >= ${pendingSince}
      AND (e.first_response_at IS NULL OR e.resolved_at IS NULL)
      AND (fr.created_at IS NOT NULL OR rs.created_at IS NOT NULL)
      AND (fr.created_at IS DISTINCT FROM e.first_response_at
           OR rs.created_at IS DISTINCT FROM e.resolved_at)`
}

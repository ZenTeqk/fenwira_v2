import { Database, type TenantTx } from '@fenwira/database'
import { QUEUES } from '@fenwira/queue'
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common'
import { type Job } from 'bullmq'
import { PinoLogger } from 'nestjs-pino'
import { MetricsService } from '../../core/metrics/metrics.service'
import { type QueueProcessor } from '../../core/queue/queue-processor'
import { QueueRegistry } from '../../core/queue/queue-registry'
import { EntitlementsService } from '../entitlements'
import { ANALYTICS_OPTIONS, type AnalyticsOptions } from './analytics.options'
import { addDays, dayIn } from './days'
import { recomputeCampaign, recomputeDay, refreshEpisodes } from './projection'

export const ROLLUP_JOB = 'rollup'
export const HEAL_JOB = 'heal'
export const RETENTION_JOB = 'retention'

/** A workspace with events in this window also gets today and yesterday recomputed each pass. */
const ACTIVE_MS = 15 * 60_000
/** Episodes still waiting for a first reply or resolution are re-evaluated this long. */
const PENDING_EPISODE_MS = 30 * 86_400_000
/** History rebuilt when retention is unlimited (and the cap for one backfill). */
const MAX_BACKFILL_DAYS = 400
/** Work items per workspace per pass; the rest waits for the next pass (bounded work). */
const MAX_ITEMS = 120
const TENANT_BATCH = 500

export type RollupResult = {
  days: number
  campaigns: number
  /** Rows replaced because they differed from source data. */
  changed: number
  /** Heal only: rows changed on days/campaigns nothing else had marked (true drift). */
  corrections: number
  status: 'ok' | 'failed'
}

const lock = (tx: TenantTx, tenantId: string) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`analytics:${tenantId}`}, 0))`

/**
 * analytics.rollup (docs/ANALYTICS.md → Rollups, Retention):
 * - every minute, recomputes the days and campaigns marked by analytics.events (after a short
 *   settle delay), plus today and yesterday for recently active workspaces;
 * - nightly (02:30 UTC), heals the last three days from source data and counts corrections;
 * - nightly (03:45 UTC), applies analytics retention from entitlements (P11-D15).
 * Recomputation replaces rows (never increments), under a per-workspace advisory lock, so
 * concurrent workers, retries and crashes can't double count. Failures are recorded per
 * workspace and never affect messaging.
 */
@Injectable()
export class AnalyticsRollupProcessor
  implements QueueProcessor, OnApplicationBootstrap, OnApplicationShutdown
{
  readonly queue = QUEUES.analyticsRollup
  readonly concurrency = 1
  private retryTimer?: NodeJS.Timeout

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(ANALYTICS_OPTIONS) private readonly options: AnalyticsOptions,
    readonly entitlements: EntitlementsService,
    private readonly queues: QueueRegistry,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('AnalyticsRollup')
  }

  onApplicationBootstrap(): void {
    void this.schedule(0)
  }

  onApplicationShutdown(): void {
    clearTimeout(this.retryTimer)
  }

  private async schedule(attempt: number): Promise<void> {
    const opts = { removeOnComplete: 50, removeOnFail: 50 }
    try {
      const q = this.queues.get(this.queue)
      await q.upsertJobScheduler(
        'analytics-rollup',
        { every: 60_000 },
        {
          name: ROLLUP_JOB,
          data: {},
          opts,
        },
      )
      await q.upsertJobScheduler(
        'analytics-heal',
        { pattern: '30 2 * * *', tz: 'UTC' },
        { name: HEAL_JOB, data: {}, opts },
      )
      await q.upsertJobScheduler(
        'analytics-retention',
        { pattern: '45 3 * * *', tz: 'UTC' },
        { name: RETENTION_JOB, data: {}, opts },
      )
    } catch {
      this.retryTimer = setTimeout(
        () => void this.schedule(attempt + 1),
        Math.min(30_000, 1000 * 2 ** attempt),
      )
    }
  }

  async process(job: Job): Promise<unknown> {
    const now = new Date()
    if (job.name === ROLLUP_JOB) return this.pass(now)
    if (job.name === HEAL_JOB) return this.heal(now)
    if (job.name === RETENTION_JOB) return this.retention(now)
    return 'ignored'
  }

  /** Traverse bounded keyset pages; continuously active early IDs cannot pin the first page. */
  private async *tenantsSince(since: Date): AsyncGenerator<string> {
    let after: string | null = null
    for (;;) {
      const ids = await this.db.system.tenantsWithActivity(since, TENANT_BATCH, after)
      if (!ids.length) return
      for (const id of ids) yield id
      after = ids[ids.length - 1]!
    }
  }

  /** One rollup pass over all workspaces with pending work or recent activity (X10). */
  async pass(now = new Date()): Promise<number> {
    let lag = 0,
      count = 0
    for await (const t of this.tenantsSince(new Date(now.getTime() - ACTIVE_MS))) {
      const r = await this.rollupTenant(t, now)
      lag = Math.max(lag, r.lagSeconds)
      count++
    }
    this.metrics.analyticsLag.set(lag)
    return count
  }

  /** Nightly heal across every eligible workspace, never a fixed first page. */
  async heal(now = new Date()): Promise<number> {
    let corrections = 0
    for await (const t of this.tenantsSince(new Date(now.getTime() - 3 * 86_400_000)))
      corrections += (await this.rollupTenant(t, now, 'heal')).corrections
    this.metrics.analyticsCorrections.inc(corrections)
    return corrections
  }

  /**
   * Brings one workspace's projection up to date. `heal` also recomputes the last three days
   * and campaigns that ran recently, ignoring the settle delay; any row it changes is a
   * correction (the projection had drifted from source data).
   */
  async rollupTenant(
    tenantId: string,
    now = new Date(),
    mode: 'pass' | 'heal' = 'pass',
  ): Promise<RollupResult & { lagSeconds: number }> {
    const started = process.hrtime.bigint()
    const result = { days: 0, campaigns: 0, changed: 0, corrections: 0, lagSeconds: 0 }
    try {
      const plan = await this.db.withTenant(tenantId, (tx) => this.plan(tx, tenantId, now, mode))
      result.lagSeconds = plan.lagSeconds
      for (const item of plan.items) {
        const changed = await this.db.withTenant(tenantId, async (tx) => {
          await lock(tx, tenantId)
          const n =
            item.scope === 'day'
              ? await recomputeDay(tx, tenantId, item.key, plan.tz)
              : await recomputeCampaign(tx, tenantId, item.key, plan.tz)
          if (item.markedAt)
            await tx.$executeRaw`
              DELETE FROM analytics_dirty
              WHERE tenant_id = ${tenantId}::uuid AND scope = ${item.scope} AND key = ${item.key}
                AND marked_at <= ${item.markedAt}`
          return n
        })
        result.changed += changed
        if (item.healOnly) result.corrections += changed
        if (item.scope === 'day') result.days++
        else result.campaigns++
      }
      await this.db.withTenant(tenantId, async (tx) => {
        await lock(tx, tenantId)
        await refreshEpisodes(
          tx,
          tenantId,
          plan.tz,
          mode === 'heal' || plan.rebuilt ? new Date(0) : new Date(now.getTime() - 2 * 86_400_000),
          new Date(now.getTime() - PENDING_EPISODE_MS),
        )
        await tx.analyticsTenantState.update({
          where: { tenantId },
          data: { lastRollupAt: now, lastError: null, lastErrorAt: null, updatedAt: now },
        })
      })
      this.metrics.analyticsRollupDuration.observe(Number(process.hrtime.bigint() - started) / 1e9)
      return { ...result, status: 'ok' }
    } catch (err) {
      this.metrics.analyticsRollupFailures.inc({ job: mode === 'heal' ? 'heal' : 'rollup' })
      this.logger.error({ err, tenantId }, 'analytics rollup failed')
      await this.recordError(tenantId, err, now)
      return { ...result, status: 'failed' }
    }
  }

  /** Decides this run's work: (re)builds, due marks, and the live days of active workspaces. */
  private async plan(tx: TenantTx, tenantId: string, now: Date, mode: 'pass' | 'heal') {
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { timezone: true },
    })
    const tz = tenant.timezone
    const today = dayIn(now, tz) // throws for an unknown timezone → recorded as a failure
    const retention = await this.entitlements.analyticsRetentionDays(tx, tenantId)
    const earliest = addDays(today, -((retention ?? MAX_BACKFILL_DAYS) - 1))
    const state =
      (await tx.analyticsTenantState.findUnique({ where: { tenantId } })) ??
      (await tx.analyticsTenantState.create({ data: { tenantId } }))

    // First build, or the workspace changed timezone: every retained day is rebuilt from source.
    const rebuilt = state.timezone !== tz || !state.backfilledAt
    if (rebuilt) {
      if (state.timezone && state.timezone !== tz) {
        await tx.$executeRaw`DELETE FROM analytics_daily_rollups WHERE tenant_id = ${tenantId}::uuid`
        await tx.$executeRaw`
          UPDATE analytics_conversation_episodes SET day = (opened_at AT TIME ZONE ${tz})::date
          WHERE tenant_id = ${tenantId}::uuid`
      }
      const first = await earliestActivity(tx, tenantId)
      if (first) {
        const from = [dayIn(first, tz), earliest].sort().pop()!
        await markRange(tx, tenantId, from, today)
      }
      await tx.$executeRaw`
        INSERT INTO analytics_dirty (tenant_id, scope, key, marked_at)
        SELECT tenant_id, 'campaign', id::text, now() - interval '1 day' FROM campaigns
        WHERE tenant_id = ${tenantId}::uuid AND status <> 'DRAFT' AND deleted_at IS NULL
        ON CONFLICT (tenant_id, scope, key) DO NOTHING`
      await tx.analyticsTenantState.update({
        where: { tenantId },
        data: { timezone: tz, backfilledAt: now, retentionDays: retention, updatedAt: now },
      })
    }
    const pending = new Set(
      (
        await tx.analyticsDirty.findMany({
          where: { tenantId },
          select: { scope: true, key: true },
        })
      ).map((m) => `${m.scope}:${m.key}`),
    )
    if (mode === 'heal') {
      // The three completed days before today (today is kept current by every pass).
      await markRange(tx, tenantId, addDays(today, -3), addDays(today, -1))
      await tx.$executeRaw`
        INSERT INTO analytics_dirty (tenant_id, scope, key, marked_at)
        SELECT tenant_id, 'campaign', id::text, now() - interval '1 day' FROM campaigns
        WHERE tenant_id = ${tenantId}::uuid AND status <> 'DRAFT' AND deleted_at IS NULL
          AND updated_at >= ${new Date(now.getTime() - 3 * 86_400_000)}
        ON CONFLICT (tenant_id, scope, key) DO UPDATE SET marked_at = EXCLUDED.marked_at`
    }
    // Marks for days outside retained history are dropped, never processed.
    await tx.$executeRaw`
      DELETE FROM analytics_dirty
      WHERE tenant_id = ${tenantId}::uuid AND scope = 'day' AND (key < ${earliest} OR key > ${today})`
    const settleBefore = new Date(
      now.getTime() - (mode === 'heal' ? 0 : this.options.settleSeconds * 1000),
    )
    const marks = await tx.analyticsDirty.findMany({
      where: { tenantId, markedAt: { lte: settleBefore } },
      orderBy: [{ scope: 'asc' }, { key: 'desc' }],
      take: MAX_ITEMS,
    })
    const oldest = await tx.analyticsDirty.findFirst({
      where: { tenantId },
      orderBy: { markedAt: 'asc' },
      select: { markedAt: true },
    })
    type Item = {
      scope: 'day' | 'campaign'
      key: string
      markedAt: Date | null
      healOnly: boolean
    }
    const items: Item[] = marks.map((m) => ({
      scope: m.scope as Item['scope'],
      key: m.key,
      markedAt: m.markedAt,
      healOnly: mode === 'heal' && !rebuilt && !pending.has(`${m.scope}:${m.key}`),
    }))
    // Live days of an active workspace: in-flight executions, settlements and status updates.
    const active = state.lastEventAt && now.getTime() - state.lastEventAt.getTime() < ACTIVE_MS
    if (active)
      for (const d of [addDays(today, -1), today])
        if (d >= earliest && !items.some((i) => i.scope === 'day' && i.key === d))
          items.push({ scope: 'day', key: d, markedAt: null, healOnly: false })
    return {
      tz,
      rebuilt,
      items,
      lagSeconds: oldest ? Math.max(0, (now.getTime() - oldest.markedAt.getTime()) / 1000) : 0,
    }
  }

  private async recordError(tenantId: string, err: unknown, now: Date) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500)
    try {
      await this.db.withTenant(
        tenantId,
        (tx) =>
          tx.$executeRaw`
          INSERT INTO analytics_tenant_state (tenant_id, last_error, last_error_at, updated_at)
          VALUES (${tenantId}::uuid, ${message}, ${now}, now())
          ON CONFLICT (tenant_id) DO UPDATE
          SET last_error = EXCLUDED.last_error, last_error_at = EXCLUDED.last_error_at,
              updated_at = now()`,
      )
    } catch (e) {
      this.logger.error({ err: e, tenantId }, 'could not record the analytics failure')
    }
  }

  /** Nightly retention (P11-D15) for every workspace with analytics data. */
  async retention(now = new Date()): Promise<number> {
    let purged = 0
    for await (const t of this.tenantsSince(new Date(0))) {
      try {
        purged += await this.retainTenant(t, now)
      } catch (err) {
        this.metrics.analyticsRollupFailures.inc({ job: 'retention' })
        this.logger.error({ err, tenantId: t }, 'analytics retention failed')
      }
    }
    return purged
  }

  /**
   * Drops analytics projections older than the workspace's `analytics_retention` entitlement.
   * Only analytics tables: messages, campaigns, executions, usage, the ledger and audit logs are
   * never touched. When retention grows, the newly covered days are rebuilt from source data
   * (customer opens older than the event log can't be, see docs/ANALYTICS.md).
   */
  async retainTenant(tenantId: string, now = new Date()): Promise<number> {
    const r = await this.db.withTenant(tenantId, async (tx) => {
      await lock(tx, tenantId)
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { timezone: true },
      })
      const days = await this.entitlements.analyticsRetentionDays(tx, tenantId)
      const state = await tx.analyticsTenantState.findUnique({ where: { tenantId } })
      const today = dayIn(now, tenant.timezone)
      const previous = state?.retentionDays ?? null
      if (days === null) {
        if (previous !== null)
          await tx.analyticsTenantState.update({
            where: { tenantId },
            data: { retentionDays: null, backfilledAt: null, updatedAt: now }, // rebuild all
          })
        return null
      }
      const earliest = addDays(today, -(days - 1))
      await tx.$executeRaw`
        DELETE FROM analytics_daily_rollups WHERE tenant_id = ${tenantId}::uuid AND day < ${earliest}::date`
      await tx.$executeRaw`
        DELETE FROM analytics_conversation_episodes
        WHERE tenant_id = ${tenantId}::uuid AND day < ${earliest}::date`
      await tx.$executeRaw`
        DELETE FROM analytics_dirty
        WHERE tenant_id = ${tenantId}::uuid AND scope = 'day' AND key < ${earliest}`
      if (previous !== null && days > previous)
        await markRange(tx, tenantId, earliest, addDays(today, -previous))
      if (state)
        await tx.analyticsTenantState.update({
          where: { tenantId },
          data: { retentionDays: days, updatedAt: now },
        })
      const [cut] = await tx.$queryRaw<Array<{ at: Date }>>`
        SELECT (${earliest}::date::timestamp AT TIME ZONE ${tenant.timezone}) AS at`
      return cut!.at
    })
    return r ? this.db.system.purgeAnalyticsEvents(tenantId, r) : 0
  }
}

/** Marks every day from `from` to `to` (inclusive), already due (no settle delay). */
async function markRange(tx: TenantTx, tenantId: string, from: string, to: string) {
  if (to < from) return
  await tx.$executeRaw`
    INSERT INTO analytics_dirty (tenant_id, scope, key, marked_at)
    SELECT ${tenantId}::uuid, 'day', to_char(d, 'YYYY-MM-DD'), now() - interval '1 day'
    FROM generate_series(${from}::date, ${to}::date, interval '1 day') AS d
    ON CONFLICT (tenant_id, scope, key) DO NOTHING`
}

/** The earliest source record analytics derives from (bounded index lookups). */
async function earliestActivity(tx: TenantTx, tenantId: string): Promise<Date | null> {
  const [r] = await tx.$queryRaw<Array<{ at: Date | null }>>`
    SELECT LEAST(
      (SELECT min(created_at) FROM messages WHERE tenant_id = ${tenantId}::uuid),
      (SELECT min(started_at) FROM automation_executions WHERE tenant_id = ${tenantId}::uuid),
      (SELECT min(occurred_at) FROM usage_events WHERE tenant_id = ${tenantId}::uuid),
      (SELECT min(occurred_at) FROM analytics_events WHERE tenant_id = ${tenantId}::uuid)
    ) AS at`
  return r?.at ?? null
}

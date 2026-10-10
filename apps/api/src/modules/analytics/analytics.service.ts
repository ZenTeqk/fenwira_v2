import {
  type AnalyticsMeta,
  type AnalyticsRangeQuery,
  type AutomationsAnalytics,
  type BreakdownRow,
  type CampaignAnalyticsRow,
  type CampaignsAnalytics,
  type InboxAnalytics,
  type Kpi,
  type MessagingAnalytics,
  type OverviewAnalytics,
  type Rate,
  type SeriesPoint,
  type UsageAnalytics,
} from '@fenwira/contracts'
import { type TenantTx } from '@fenwira/database'
import { Injectable } from '@nestjs/common'
import { TenantDb } from '../../core/database/tenant-db'
import { AppError } from '../../core/http/app-error'
import { EntitlementsService } from '../entitlements'
import { currentTenant } from '../tenancy'
import { addDays, dayIn, daysBetween, eachDay } from './days'

const MAX_RANGE_DAYS = 366
const DEFAULT_RANGE_DAYS = 30

type Range = { from: string; to: string }
type Ctx = {
  tx: TenantTx
  tenantId: string
  tz: string
  meta: AnalyticsMeta
  cur: Range
  prev: Range | null
}
/** metric → dims key → value */
type Sums = Map<string, Map<string, number>>

const n = (s: Sums, metric: string, dims = '') => s.get(metric)?.get(dims) ?? 0
const kpi = (cur: Sums, prev: Sums | null, metric: string, dims = ''): Kpi => ({
  value: n(cur, metric, dims),
  previous: prev ? n(prev, metric, dims) : null,
})
/** null when there's nothing to divide by: "no data" is never shown as 0 %. */
const ratio = (num: number, den: number) => (den > 0 ? num / den : null)
const rate = (
  cur: Sums,
  prev: Sums | null,
  num: (s: Sums) => number,
  den: (s: Sums) => number,
): Rate => ({
  value: ratio(num(cur), den(cur)),
  numerator: num(cur),
  denominator: den(cur),
  previous: prev ? ratio(num(prev), den(prev)) : null,
})
/** Rows of one dimension ("category:UTILITY" → key UTILITY) for the given metrics. */
function breakdown(
  s: Sums,
  dim: string,
  metrics: Record<string, string>,
  label: (key: string) => string = (k) => k,
): BreakdownRow[] {
  const keys = new Set<string>()
  for (const metric of Object.values(metrics))
    for (const d of s.get(metric)?.keys() ?? []) if (d.startsWith(`${dim}:`)) keys.add(d)
  return [...keys]
    .map((d) => {
      const key = d.slice(dim.length + 1)
      const values: Record<string, number> = {}
      for (const [name, metric] of Object.entries(metrics)) values[name] = n(s, metric, d)
      return { key, label: label(key), values }
    })
    .sort((a, b) => Object.values(b.values)[0]! - Object.values(a.values)[0]!)
}

const SENT = (s: Sums) => n(s, 'msg.out.sent')
const DELIVERED = (s: Sums) => n(s, 'msg.out.delivered')
const READ = (s: Sums) => n(s, 'msg.out.read')
const FAILED = (s: Sums) => n(s, 'msg.out.failed')

/**
 * Analytics read API (docs/ANALYTICS.md → Metric definitions). Reads daily rollups for the
 * workspace-local range, plus bounded live counts (open conversations now) and the episode
 * table for median response times. Everything runs inside the workspace's RLS transaction.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly tenantDb: TenantDb,
    readonly entitlements: EntitlementsService,
  ) {}

  private run<T>(query: AnalyticsRangeQuery, fn: (c: Ctx) => Promise<T>): Promise<T> {
    const { tenantId } = currentTenant()
    return this.tenantDb.run(async (tx) => fn(await this.context(tx, tenantId, query)))
  }

  /** The shared date-range contract: workspace-local days, retention and freshness. */
  private async context(tx: TenantTx, tenantId: string, q: AnalyticsRangeQuery): Promise<Ctx> {
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { timezone: true },
    })
    const tz = tenant.timezone
    const today = dayIn(new Date(), tz)
    let to = q.to && q.to < today ? q.to : today
    let from = q.from ?? addDays(to, -((q.days ?? DEFAULT_RANGE_DAYS) - 1))
    if (from > to)
      throw AppError.validation([
        { path: 'from', code: 'invalid', message: 'The start date must be before the end date.' },
      ])
    if (daysBetween(from, to) > MAX_RANGE_DAYS)
      throw AppError.validation([
        { path: 'from', code: 'too_long', message: `Choose at most ${MAX_RANGE_DAYS} days.` },
      ])
    const retention = await this.entitlements.analyticsRetentionDays(tx, tenantId)
    const earliest = retention === null ? null : addDays(today, -(retention - 1))
    let clamped = false
    if (earliest && from < earliest) {
      from = earliest
      clamped = true
      if (to < from) to = from
    }
    const length = daysBetween(from, to)
    const prevTo = addDays(from, -1)
    const prevFrom = addDays(from, -length)
    const prev =
      q.compare && (!earliest || prevFrom >= earliest) ? { from: prevFrom, to: prevTo } : null

    const state = await tx.analyticsTenantState.findUnique({ where: { tenantId } })
    const pending = await tx.analyticsDirty.count({ where: { tenantId } })
    const status: AnalyticsMeta['freshness']['status'] = !state?.lastRollupAt
      ? 'NOT_STARTED'
      : state.lastErrorAt && state.lastErrorAt >= state.lastRollupAt
        ? 'DEGRADED'
        : pending > 0 || !state.backfilledAt || state.timezone !== tz
          ? 'PROCESSING'
          : 'READY'
    return {
      tx,
      tenantId,
      tz,
      cur: { from, to },
      prev,
      meta: {
        range: { from, to, days: length },
        previous: prev,
        timezone: tz,
        today,
        partial: to === today,
        retention: { days: retention, earliestDay: earliest, clamped },
        freshness: {
          status,
          lastProcessedAt: state?.lastRollupAt?.toISOString() ?? null,
          pending,
        },
      },
    }
  }

  private async sums(c: Ctx, range: Range | null, metrics: string[]): Promise<Sums | null> {
    if (!range) return null
    const rows = await c.tx.$queryRaw<Array<{ metric: string; dims: string; v: bigint }>>`
      SELECT metric, dims_key AS dims, sum(value)::bigint AS v FROM analytics_daily_rollups
      WHERE tenant_id = ${c.tenantId}::uuid AND day >= ${range.from}::date
        AND day <= ${range.to}::date AND metric = ANY(${metrics}::text[])
      GROUP BY 1, 2`
    const out: Sums = new Map()
    for (const r of rows) {
      if (!out.has(r.metric)) out.set(r.metric, new Map())
      out.get(r.metric)!.set(r.dims, Number(r.v))
    }
    return out
  }

  /** Daily totals (dims "") of `metrics`, every day of the range present (0 = processed, none). */
  private async series(c: Ctx, metrics: Record<string, string>, dims = ''): Promise<SeriesPoint[]> {
    const rows = await c.tx.$queryRaw<Array<{ day: Date; metric: string; v: bigint }>>`
      SELECT day, metric, sum(value)::bigint AS v FROM analytics_daily_rollups
      WHERE tenant_id = ${c.tenantId}::uuid AND day >= ${c.cur.from}::date
        AND day <= ${c.cur.to}::date AND metric = ANY(${Object.values(metrics)}::text[])
        AND dims_key = ${dims}
      GROUP BY 1, 2`
    const byDay = new Map<string, Map<string, number>>()
    for (const r of rows) {
      const d = r.day.toISOString().slice(0, 10)
      if (!byDay.has(d)) byDay.set(d, new Map())
      byDay.get(d)!.set(r.metric, Number(r.v))
    }
    return eachDay(c.cur.from, c.cur.to).map((day) => ({
      day,
      values: Object.fromEntries(
        Object.entries(metrics).map(([name, metric]) => [name, byDay.get(day)?.get(metric) ?? 0]),
      ),
    }))
  }

  // ---------------------------------------------------------------------------- messaging

  messaging(q: AnalyticsRangeQuery): Promise<MessagingAnalytics> {
    return this.run(q, async (c) => {
      const metrics = [
        'msg.out.sent',
        'msg.out.delivered',
        'msg.out.read',
        'msg.out.failed',
        'msg.out.accepted',
        'msg.out.pending',
        'msg.in',
      ]
      const cur = (await this.sums(c, c.cur, metrics))!
      const prev = await this.sums(c, c.prev, metrics)
      const phones = await c.tx.whatsAppPhoneNumber.findMany({
        select: { id: true, displayPhoneNumber: true, verifiedName: true },
      })
      const phoneLabel = (id: string) => {
        const p = phones.find((x) => x.id === id)
        if (!p) return 'Removed number'
        return p.verifiedName ? `${p.verifiedName} (${p.displayPhoneNumber})` : p.displayPhoneNumber
      }
      const statuses = {
        sent: 'msg.out.sent',
        delivered: 'msg.out.delivered',
        read: 'msg.out.read',
        failed: 'msg.out.failed',
      }
      return {
        meta: c.meta,
        kpis: {
          sent: kpi(cur, prev, 'msg.out.sent'),
          delivered: kpi(cur, prev, 'msg.out.delivered'),
          read: kpi(cur, prev, 'msg.out.read'),
          failed: kpi(cur, prev, 'msg.out.failed'),
          inbound: kpi(cur, prev, 'msg.in'),
          deliveryRate: rate(cur, prev, DELIVERED, SENT),
          readRate: rate(cur, prev, READ, DELIVERED),
          failureRate: rate(cur, prev, FAILED, (s) => SENT(s) + FAILED(s)),
        },
        series: await this.series(c, statuses),
        byCategory: breakdown(cur, 'category', statuses, (k) => CATEGORY_LABEL[k] ?? k),
        bySource: breakdown(cur, 'source', statuses, (k) => SOURCE_LABEL[k] ?? k),
        byPhoneNumber: breakdown(cur, 'phone', statuses, phoneLabel),
        failureReasons: breakdown(cur, 'error', { failed: 'msg.out.failed' }),
      }
    })
  }

  // ---------------------------------------------------------------------------- campaigns

  private async campaignRows(c: Ctx, range: Range, limit: number): Promise<CampaignAnalyticsRow[]> {
    const rows = await c.tx.$queryRaw<Array<{ id: string; day: Date; metric: string; v: bigint }>>`
      SELECT substring(dims_key FROM 10) AS id, day, metric, sum(value)::bigint AS v
      FROM analytics_daily_rollups
      WHERE tenant_id = ${c.tenantId}::uuid AND day >= ${range.from}::date
        AND day <= ${range.to}::date AND metric LIKE 'cmp.%'
        AND dims_key LIKE 'campaign:%' AND position('|' IN dims_key) = 0
      GROUP BY 1, 2, 3`
    const by = new Map<string, { day: string; m: Map<string, number> }>()
    for (const r of rows) {
      if (!by.has(r.id)) by.set(r.id, { day: r.day.toISOString().slice(0, 10), m: new Map() })
      by.get(r.id)!.m.set(r.metric, Number(r.v))
    }
    const campaigns = await c.tx.campaign.findMany({
      where: { id: { in: [...by.keys()] } },
      select: { id: true, name: true, status: true },
    })
    return campaigns
      .map((x) => {
        const { day, m } = by.get(x.id)!
        const g = (k: string) => m.get(`cmp.${k}`) ?? 0
        return {
          campaignId: x.id,
          name: x.name,
          status: x.status,
          startedDay: day,
          recipients: g('recipients'),
          sent: g('sent'),
          delivered: g('delivered'),
          read: g('read'),
          failed: g('failed'),
          skipped: g('skipped'),
          inProgress: g('in_progress'),
          deliveryRate: ratio(g('delivered'), g('sent')),
          readRate: ratio(g('read'), g('delivered')),
          failureRate: ratio(g('failed'), g('sent') + g('failed')),
        }
      })
      .sort((a, b) => b.startedDay.localeCompare(a.startedDay) || b.recipients - a.recipients)
      .slice(0, limit)
  }

  campaigns(q: AnalyticsRangeQuery): Promise<CampaignsAnalytics> {
    return this.run(q, async (c) => {
      const rows = await this.campaignRows(c, c.cur, 500)
      const prevRows = c.prev ? await this.campaignRows(c, c.prev, 500) : null
      const total = (rs: CampaignAnalyticsRow[], k: keyof CampaignAnalyticsRow) =>
        rs.reduce((a, r) => a + (r[k] as number), 0)
      const k = (key: keyof CampaignAnalyticsRow): Kpi => ({
        value: total(rows, key),
        previous: prevRows ? total(prevRows, key) : null,
      })
      const r = (
        num: keyof CampaignAnalyticsRow,
        den: (rs: CampaignAnalyticsRow[]) => number,
      ): Rate => ({
        value: ratio(total(rows, num), den(rows)),
        numerator: total(rows, num),
        denominator: den(rows),
        previous: prevRows ? ratio(total(prevRows, num), den(prevRows)) : null,
      })
      const skipRows = await c.tx.$queryRaw<Array<{ reason: string; v: bigint }>>`
        SELECT split_part(dims_key, '|skip:', 2) AS reason, sum(value)::bigint AS v
        FROM analytics_daily_rollups
        WHERE tenant_id = ${c.tenantId}::uuid AND day >= ${c.cur.from}::date
          AND day <= ${c.cur.to}::date AND metric = 'cmp.skipped' AND dims_key LIKE '%|skip:%'
        GROUP BY 1 ORDER BY 2 DESC`
      return {
        meta: c.meta,
        kpis: {
          campaigns: { value: rows.length, previous: prevRows ? prevRows.length : null },
          recipients: k('recipients'),
          skipped: k('skipped'),
          sent: k('sent'),
          delivered: k('delivered'),
          read: k('read'),
          failed: k('failed'),
          deliveryRate: r('delivered', (rs) => total(rs, 'sent')),
          readRate: r('read', (rs) => total(rs, 'delivered')),
          failureRate: r('failed', (rs) => total(rs, 'sent') + total(rs, 'failed')),
        },
        campaigns: rows,
        skipReasons: skipRows.map((x) => ({
          key: x.reason,
          label: x.reason,
          values: { skipped: Number(x.v) },
        })),
      }
    })
  }

  // ------------------------------------------------------------------------------- inbox

  inbox(q: AnalyticsRangeQuery): Promise<InboxAnalytics> {
    return this.run(q, async (c) => {
      const metrics = ['conv.opened', 'conv.new', 'conv.resolved', 'conv.assigned']
      const cur = (await this.sums(c, c.cur, metrics))!
      const prev = await this.sums(c, c.prev, metrics)
      const [ep] = await c.tx.$queryRaw<
        Array<{ frt: number | null; res: number | null; responses: bigint; awaiting: bigint }>
      >`
        SELECT
          percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM first_response_at - opened_at))
            FILTER (WHERE first_response_at IS NOT NULL) AS frt,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM resolved_at - opened_at))
            FILTER (WHERE resolved_at IS NOT NULL) AS res,
          count(first_response_at)::bigint AS responses,
          count(*) FILTER (WHERE first_response_at IS NULL AND resolved_at IS NULL)::bigint AS awaiting
        FROM analytics_conversation_episodes
        WHERE tenant_id = ${c.tenantId}::uuid AND day >= ${c.cur.from}::date AND day <= ${c.cur.to}::date`
      const live = await c.tx.conversation.groupBy({
        by: ['assigneeId'],
        where: { status: 'OPEN' },
        _count: { _all: true },
      })
      const openNow = live.reduce((a, r) => a + r._count._all, 0)
      const perAgentFrt = await c.tx.$queryRaw<
        Array<{ user_id: string; responses: bigint; frt: number | null }>
      >`
        SELECT first_responder_id::text AS user_id, count(*)::bigint AS responses,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM first_response_at - opened_at)) AS frt
        FROM analytics_conversation_episodes
        WHERE tenant_id = ${c.tenantId}::uuid AND day >= ${c.cur.from}::date
          AND day <= ${c.cur.to}::date AND first_responder_id IS NOT NULL
        GROUP BY 1`
      const agentIds = new Set<string>()
      for (const m of ['conv.assigned', 'conv.resolved'])
        for (const d of cur.get(m)?.keys() ?? [])
          if (d.startsWith('agent:')) agentIds.add(d.slice(6))
      for (const r of perAgentFrt) agentIds.add(r.user_id)
      for (const r of live) if (r.assigneeId) agentIds.add(r.assigneeId)
      const users = await c.tx.user.findMany({
        where: { id: { in: [...agentIds] } },
        select: { id: true, name: true },
      })
      const [since] = await c.tx.$queryRaw<Array<{ day: Date | null }>>`
        SELECT min(day) AS day FROM analytics_conversation_episodes WHERE tenant_id = ${c.tenantId}::uuid`
      return {
        meta: c.meta,
        kpis: {
          opened: kpi(cur, prev, 'conv.opened'),
          newConversations: kpi(cur, prev, 'conv.new'),
          resolved: kpi(cur, prev, 'conv.resolved'),
          medianFirstResponseSeconds:
            ep?.frt === null || ep?.frt === undefined ? null : Math.round(ep.frt),
          medianResolutionSeconds:
            ep?.res === null || ep?.res === undefined ? null : Math.round(ep.res),
          firstResponses: Number(ep?.responses ?? 0),
          awaitingFirstResponse: Number(ep?.awaiting ?? 0),
          openNow,
          unassignedNow: live.find((r) => r.assigneeId === null)?._count._all ?? 0,
        },
        series: await this.series(c, {
          opened: 'conv.opened',
          newConversations: 'conv.new',
          resolved: 'conv.resolved',
        }),
        agents: [...agentIds]
          .map((id) => {
            const f = perAgentFrt.find((r) => r.user_id === id)
            return {
              userId: id,
              name: users.find((u) => u.id === id)?.name ?? 'Former member',
              assignedOpenNow: live.find((r) => r.assigneeId === id)?._count._all ?? 0,
              assigned: n(cur, 'conv.assigned', `agent:${id}`),
              firstResponses: Number(f?.responses ?? 0),
              medianFirstResponseSeconds:
                f?.frt === null || f?.frt === undefined ? null : Math.round(f.frt),
              resolved: n(cur, 'conv.resolved', `agent:${id}`),
            }
          })
          .sort((a, b) => b.firstResponses - a.firstResponses || b.resolved - a.resolved),
        episodesSince: since?.day ? since.day.toISOString().slice(0, 10) : null,
      }
    })
  }

  // --------------------------------------------------------------------------- automations

  automations(q: AnalyticsRangeQuery): Promise<AutomationsAnalytics> {
    return this.run(q, async (c) => {
      const metrics = [
        'auto.started',
        'auto.completed',
        'auto.failed',
        'auto.cancelled',
        'auto.stopped_takeover',
        'auto.in_progress',
        'auto.finished',
        'auto.duration_ms',
        'auto.step_failed',
      ]
      const cur = (await this.sums(c, c.cur, metrics))!
      const prev = await this.sums(c, c.prev, metrics)
      const finished = (s: Sums, d = '') => n(s, 'auto.finished', d)
      const flowIds = [...(cur.get('auto.started')?.keys() ?? [])]
        .filter((d) => d.startsWith('flow:'))
        .map((d) => d.slice(5))
      const flows = await c.tx.flow.findMany({
        where: { id: { in: flowIds } },
        select: { id: true, name: true },
      })
      const avg = (s: Sums, d = '') => {
        const f = finished(s, d)
        return f > 0 ? Math.round(n(s, 'auto.duration_ms', d) / f / 100) / 10 : null
      }
      return {
        meta: c.meta,
        kpis: {
          executions: kpi(cur, prev, 'auto.started'),
          completed: kpi(cur, prev, 'auto.completed'),
          failed: kpi(cur, prev, 'auto.failed'),
          cancelled: kpi(cur, prev, 'auto.cancelled'),
          stoppedByTakeover: kpi(cur, prev, 'auto.stopped_takeover'),
          inProgress: n(cur, 'auto.in_progress'),
          successRate: rate(
            cur,
            prev,
            (s) => n(s, 'auto.completed'),
            (s) => finished(s),
          ),
          failureRate: rate(
            cur,
            prev,
            (s) => n(s, 'auto.failed'),
            (s) => finished(s),
          ),
          averageDurationSeconds: avg(cur),
          stepFailures: kpi(cur, prev, 'auto.step_failed'),
        },
        series: await this.series(c, {
          completed: 'auto.completed',
          failed: 'auto.failed',
          cancelled: 'auto.cancelled',
          stoppedByTakeover: 'auto.stopped_takeover',
          inProgress: 'auto.in_progress',
        }),
        flows: flowIds
          .map((id) => {
            const d = `flow:${id}`
            return {
              flowId: id,
              name: flows.find((f) => f.id === id)?.name ?? 'Deleted automation',
              executions: n(cur, 'auto.started', d),
              completed: n(cur, 'auto.completed', d),
              failed: n(cur, 'auto.failed', d),
              cancelled: n(cur, 'auto.cancelled', d),
              stoppedByTakeover: n(cur, 'auto.stopped_takeover', d),
              inProgress: n(cur, 'auto.in_progress', d),
              successRate: ratio(n(cur, 'auto.completed', d), finished(cur, d)),
              averageDurationSeconds: avg(cur, d),
            }
          })
          .sort((a, b) => b.executions - a.executions),
        stepFailuresByType: breakdown(cur, 'node', { failed: 'auto.step_failed' }),
      }
    })
  }

  // --------------------------------------------------------------------------------- usage

  private async currency(c: Ctx): Promise<string> {
    const w = await c.tx.wallet.findFirst({ select: { currency: true } })
    return w?.currency ?? 'INR'
  }

  usage(q: AnalyticsRangeQuery): Promise<UsageAnalytics> {
    return this.run(q, async (c) => {
      const currency = await this.currency(c)
      const cur$ = `cur:${currency}`
      const metrics = ['usage.messages', 'usage.charge_minor', 'usage.promo_credit_minor']
      const cur = (await this.sums(c, c.cur, metrics))!
      const prev = await this.sums(c, c.prev, metrics)
      const categories = new Set<string>()
      for (const d of cur.get('usage.messages')?.keys() ?? [])
        if (d.startsWith('category:')) categories.add(d.slice(9))
      const byDay = await c.tx.$queryRaw<Array<{ day: Date; category: string; v: bigint }>>`
        SELECT day, split_part(dims_key, '|category:', 2) AS category, sum(value)::bigint AS v
        FROM analytics_daily_rollups
        WHERE tenant_id = ${c.tenantId}::uuid AND day >= ${c.cur.from}::date
          AND day <= ${c.cur.to}::date AND metric = 'usage.charge_minor'
          AND dims_key LIKE ${`${cur$}|category:%`}
        GROUP BY 1, 2`
      return {
        meta: c.meta,
        currency,
        kpis: {
          billableMessages: kpi(cur, prev, 'usage.messages'),
          chargeMinor: kpi(cur, prev, 'usage.charge_minor', cur$),
          promotionalCreditsMinor: kpi(cur, prev, 'usage.promo_credit_minor', cur$),
        },
        series: eachDay(c.cur.from, c.cur.to).map((day) => ({
          day,
          values: Object.fromEntries(
            [...categories].map((k) => [
              k,
              Number(
                byDay.find((r) => r.day.toISOString().slice(0, 10) === day && r.category === k)
                  ?.v ?? 0,
              ),
            ]),
          ),
        })),
        byCategory: [...categories]
          .map((k) => ({
            key: k,
            label: CATEGORY_LABEL[k] ?? k,
            values: {
              messages: n(cur, 'usage.messages', `category:${k}`),
              chargeMinor: n(cur, 'usage.charge_minor', `${cur$}|category:${k}`),
            },
          }))
          .sort((a, b) => b.values.chargeMinor - a.values.chargeMinor),
      }
    })
  }

  // ------------------------------------------------------------------------------ overview

  overview(q: AnalyticsRangeQuery, canSeeMoney: boolean): Promise<OverviewAnalytics> {
    return this.run(q, async (c) => {
      const currency = canSeeMoney ? await this.currency(c) : null
      const metrics = [
        'msg.out.sent',
        'msg.out.delivered',
        'msg.out.read',
        'msg.out.failed',
        'auto.failed',
        'auto.started',
        'usage.charge_minor',
      ]
      const cur = (await this.sums(c, c.cur, metrics))!
      const prev = await this.sums(c, c.prev, metrics)
      const flowIds = [...(cur.get('auto.started')?.keys() ?? [])]
        .filter((d) => d.startsWith('flow:'))
        .map((d) => d.slice(5))
      const flows = await c.tx.flow.findMany({
        where: { id: { in: flowIds } },
        select: { id: true, name: true },
      })
      return {
        meta: c.meta,
        kpis: {
          sent: kpi(cur, prev, 'msg.out.sent'),
          deliveryRate: rate(cur, prev, DELIVERED, SENT),
          openConversations: await c.tx.conversation.count({ where: { status: 'OPEN' } }),
          failed: kpi(cur, prev, 'msg.out.failed'),
          automationFailures: kpi(cur, prev, 'auto.failed'),
          chargeMinor: currency ? kpi(cur, prev, 'usage.charge_minor', `cur:${currency}`) : null,
        },
        currency,
        series: await this.series(c, {
          sent: 'msg.out.sent',
          delivered: 'msg.out.delivered',
          read: 'msg.out.read',
          failed: 'msg.out.failed',
        }),
        topCampaigns: (await this.campaignRows(c, c.cur, 500))
          .sort((a, b) => b.recipients - a.recipients)
          .slice(0, 5),
        topFlows: flowIds
          .map((id) => ({
            flowId: id,
            name: flows.find((f) => f.id === id)?.name ?? 'Deleted automation',
            executions: n(cur, 'auto.started', `flow:${id}`),
          }))
          .sort((a, b) => b.executions - a.executions)
          .slice(0, 5),
      }
    })
  }
}

const CATEGORY_LABEL: Record<string, string> = {
  MARKETING: 'Marketing',
  UTILITY: 'Utility',
  AUTHENTICATION: 'Authentication',
  SERVICE: 'Free-form (service)',
}
const SOURCE_LABEL: Record<string, string> = {
  INBOX: 'Inbox replies',
  CAMPAIGN: 'Campaigns',
  AUTOMATION: 'Automations',
  API: 'API',
  SYSTEM: 'System',
}

import {
  type Campaign,
  type CampaignAudience,
  type CampaignEstimate,
  type CampaignRecipient,
  type CampaignStats,
  type CampaignStatus,
  type CreateCampaign,
  type RecipientStatus,
  type SkipReason,
  type TemplateCategory,
  type TemplateComponents,
  type VariableMapping,
} from '@fenwira/contracts'
import { Database, Prisma, type TenantTx } from '@fenwira/database'
import { Inject, Injectable } from '@nestjs/common'
import { Readable } from 'node:stream'
import { TenantDb } from '../../core/database/tenant-db'
import { AppError } from '../../core/http/app-error'
import { countryOf } from '../../core/phone'
import { RealtimeEmitter } from '../../core/realtime/realtime-emitter'
import { AuditService } from '../audit'
import { availableOf, billingEnforcedFor, lockWallet, unitPrice } from '../billing'
import { currentAuth } from '../identity'
import { currentTenant } from '../tenancy'
import {
  audiencePages,
  audienceWhere,
  campaignStats,
  classify,
  mappingGaps,
  resolveVariables,
  toCampaign,
  toRecipient,
} from './campaigns.core'
import { CAMPAIGNS_OPTIONS, type CampaignsOptions } from './campaigns.options'

type CampaignRow = Prisma.CampaignGetPayload<object>
type TemplateSnapshot = NonNullable<Campaign['template']>

const invalidState = (status: CampaignStatus, action: string) =>
  new AppError(
    'CAMPAIGN_INVALID_STATE',
    409,
    `A ${status.toLowerCase().replaceAll('_', ' ')} campaign can't be ${action}.`,
    {
      status,
    },
  )
const notReady = (problems: Array<{ code: string; message: string }>) =>
  new AppError(
    'CAMPAIGN_NOT_READY',
    422,
    problems[0]?.message ?? 'The campaign is not ready to launch.',
    {
      problems,
    },
  )
const TIER_LIMITS: Record<string, number> = {
  TIER_250: 250,
  TIER_1K: 1000,
  TIER_10K: 10_000,
  TIER_100K: 100_000,
}

/**
 * Campaigns API side (docs/CAMPAIGN_ENGINE.md): drafts, the Review estimate, launch and controls.
 * The worker snapshots and dispatches; every send goes through MessagingService.
 */
@Injectable()
export class CampaignsService {
  constructor(
    @Inject(Database) private readonly db: Database,
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeEmitter,
    @Inject(CAMPAIGNS_OPTIONS) private readonly options: CampaignsOptions,
  ) {}

  // ------------------------------------------------------------------------------ reads

  list(status?: CampaignStatus): Promise<Campaign[]> {
    return this.tenantDb.run(async (tx) => {
      const rows = await tx.campaign.findMany({
        where: { deletedAt: null, ...(status ? { status } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 200,
      })
      const phones = await this.phoneDisplays(tx, rows)
      return rows.map((r) => toCampaign(r, phones.get(r.phoneNumberId ?? '') ?? null))
    })
  }

  get(id: string): Promise<Campaign> {
    return this.tenantDb.run(async (tx) => this.dto(tx, await this.find(tx, id)))
  }

  stats(id: string): Promise<CampaignStats> {
    return this.tenantDb.run(async (tx) => campaignStats(tx, await this.find(tx, id)))
  }

  recipients(
    id: string,
    q: { status?: RecipientStatus; skipReason?: SkipReason; limit: number; cursor?: string },
  ): Promise<{ items: CampaignRecipient[]; nextCursor: string | null }> {
    return this.tenantDb.run(async (tx) => {
      await this.find(tx, id)
      const rows = await tx.campaignRecipient.findMany({
        where: {
          campaignId: id,
          ...(q.status ? { status: q.status } : {}),
          ...(q.skipReason ? { skipReason: q.skipReason } : {}),
          ...(q.cursor ? { id: { gt: q.cursor } } : {}),
        },
        orderBy: { id: 'asc' },
        take: q.limit + 1,
      })
      const more = rows.length > q.limit
      const items = rows.slice(0, q.limit)
      return { items: items.map(toRecipient), nextCursor: more ? items.at(-1)!.id : null }
    })
  }

  /** CSV of every recipient, streamed page by page (bounded memory). */
  async exportRecipients(id: string): Promise<Readable> {
    const { tenantId } = currentTenant()
    await this.tenantDb.run((tx) => this.find(tx, id))
    const db = this.db
    const cell = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
    }
    async function* rows() {
      yield 'contact_id,name,phone,status,skip_reason,error_code,queued_at,sent_at,delivered_at,read_at,failed_at\n'
      let cursor: string | undefined
      for (;;) {
        const page = await db.withTenant(tenantId, (tx) =>
          tx.campaignRecipient.findMany({
            where: { campaignId: id, ...(cursor ? { id: { gt: cursor } } : {}) },
            orderBy: { id: 'asc' },
            take: 1000,
          }),
        )
        if (!page.length) return
        yield page
          .map((r) =>
            [
              r.contactId,
              r.contactName,
              r.phoneE164,
              r.status,
              r.skipReason,
              r.errorCode,
              r.queuedAt?.toISOString(),
              r.sentAt?.toISOString(),
              r.deliveredAt?.toISOString(),
              r.readAt?.toISOString(),
              r.failedAt?.toISOString(),
            ]
              .map(cell)
              .join(','),
          )
          .join('\n')
          .concat('\n')
        cursor = page.at(-1)!.id
      }
    }
    await this.tenantDb.run((tx) =>
      this.audit.write(tx, {
        action: 'campaign.recipients_exported',
        targetType: 'campaign',
        targetId: id,
        changes: {},
      }),
    )
    return Readable.from(rows())
  }

  // ------------------------------------------------------------------------------ drafts

  async create(input: CreateCampaign): Promise<Campaign> {
    const { tenantId } = currentTenant()
    const { userId } = currentAuth()
    return this.tenantDb.run(async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { timezone: true },
      })
      await this.checkRefs(tx, input)
      const c = await tx.campaign.create({
        data: {
          tenantId,
          name: input.name,
          phoneNumberId: input.phoneNumberId ?? null,
          templateVersionId: input.templateVersionId ?? null,
          audience: (input.audience ?? { include: [], exclude: [] }) as object,
          variableMapping: (input.variableMapping ?? { body: [] }) as object,
          scheduleAt: input.scheduleAt ? new Date(input.scheduleAt) : null,
          timezone: tenant.timezone,
          rateLimitPerMinute: input.rateLimitPerMinute ?? null,
          createdBy: userId,
        },
      })
      await this.audit.write(tx, {
        action: 'campaign.created',
        targetType: 'campaign',
        targetId: c.id,
        changes: { name: c.name },
      })
      return this.dto(tx, c)
    })
  }

  update(id: string, input: Partial<CreateCampaign>): Promise<Campaign> {
    return this.tenantDb.run(async (tx) => {
      const c = await this.find(tx, id)
      if (c.status !== 'DRAFT') throw invalidState(c.status, 'edited')
      await this.checkRefs(tx, input)
      const updated = await tx.campaign.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.phoneNumberId !== undefined ? { phoneNumberId: input.phoneNumberId } : {}),
          ...(input.templateVersionId !== undefined
            ? { templateVersionId: input.templateVersionId }
            : {}),
          ...(input.audience !== undefined ? { audience: input.audience as object } : {}),
          ...(input.variableMapping !== undefined
            ? { variableMapping: input.variableMapping as object }
            : {}),
          ...(input.scheduleAt !== undefined
            ? { scheduleAt: input.scheduleAt ? new Date(input.scheduleAt) : null }
            : {}),
          ...(input.rateLimitPerMinute !== undefined
            ? { rateLimitPerMinute: input.rateLimitPerMinute }
            : {}),
        },
      })
      return this.dto(tx, updated)
    })
  }

  remove(id: string): Promise<void> {
    return this.tenantDb.run(async (tx) => {
      const c = await this.find(tx, id)
      if (c.status !== 'DRAFT') throw invalidState(c.status, 'deleted')
      await tx.campaign.update({ where: { id }, data: { deletedAt: new Date() } })
      await this.audit.write(tx, {
        action: 'campaign.deleted',
        targetType: 'campaign',
        targetId: id,
        changes: {},
      })
    })
  }

  // ------------------------------------------------------------------------------ review

  /** The Review step: evaluates the audience page by page without snapshotting it. */
  estimate(id: string): Promise<CampaignEstimate> {
    const { tenantId } = currentTenant()
    return this.tenantDb.run(async (tx) => {
      const c = await this.find(tx, id)
      const ready = await this.readiness(tx, c)
      const template = ready.template
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { defaultCountry: true },
      })
      const skipped: Record<string, number> = {}
      const samples: CampaignEstimate['samples'] = []
      const byCountry = new Map<string | null, number>()
      let total = 0
      let sendable = 0
      if (template) {
        const where = await audienceWhere(tx, c.audience as CampaignAudience)
        for await (const page of audiencePages(tx, where)) {
          for (const contact of page) {
            total += 1
            const variables = resolveVariables(c.variableMapping as VariableMapping, contact)
            const reason = classify(contact, template, variables, tenant.defaultCountry)
            if (reason) skipped[reason] = (skipped[reason] ?? 0) + 1
            else {
              sendable += 1
              const country = contact.country ?? countryOf(contact.phoneE164)
              byCountry.set(country, (byCountry.get(country) ?? 0) + 1)
              if (samples.length < 3)
                samples.push({ contactName: contact.name, phoneE164: contact.phoneE164, variables })
            }
          }
        }
      }
      let cost: bigint | null = template ? 0n : null
      let currency = 'INR'
      for (const [country, n] of byCountry) {
        const price = template ? await unitPrice(tx, template.category, country) : null
        if (!price) {
          cost = null
          break
        }
        currency = price.currency
        if (cost !== null) cost += price.customerPriceMinor * BigInt(n)
      }
      const enforced = await billingEnforcedFor(tx, tenantId, this.options.billing)
      const wallet = enforced ? await lockWallet(tx, tenantId, this.options.billing) : null
      const available = wallet ? availableOf(wallet) : null
      const warnings = [...ready.problems]
      const phone = c.phoneNumberId
        ? await tx.whatsAppPhoneNumber.findFirst({ where: { id: c.phoneNumberId } })
        : null
      if (phone && (phone.qualityRating === 'RED' || phone.qualityRating === 'YELLOW'))
        warnings.push({
          code: 'PHONE_QUALITY',
          message: `This number's quality rating is ${phone.qualityRating === 'RED' ? 'low' : 'medium'}. Large sends may lower it further.`,
        })
      const tier = phone?.messagingLimitTier ? TIER_LIMITS[phone.messagingLimitTier] : undefined
      if (tier && sendable > tier)
        warnings.push({
          code: 'MESSAGING_LIMIT',
          message: `This number can start ${tier.toLocaleString('en-IN')} conversations a day; ${sendable.toLocaleString('en-IN')} recipients will take longer.`,
        })
      if (available !== null && cost !== null && cost > available)
        warnings.push({
          code: 'LOW_BALANCE',
          message:
            'Your available credits don’t cover the estimated cost. The campaign will pause when they run out.',
        })
      return {
        total,
        sendable,
        skipped,
        estimatedCostMinor: cost === null ? null : Number(cost),
        currency: wallet?.currency ?? currency,
        availableFundsMinor: available === null ? null : Number(available),
        billingEnforced: enforced,
        samples,
        warnings,
      }
    })
  }

  // ------------------------------------------------------------------------------ lifecycle

  /** Launch (IK): SCHEDULED when `scheduleAt` is in the future, else PREPARING + snapshot. */
  launch(id: string): Promise<Campaign> {
    const { tenantId } = currentTenant()
    const { userId } = currentAuth()
    return this.transition(id, async (tx, c) => {
      if (c.status !== 'DRAFT') throw invalidState(c.status, 'launched')
      const ready = await this.readiness(tx, c)
      const problems = ready.problems.filter((p) => p.code !== 'AUDIENCE_EMPTY_WARNING')
      if (problems.length || !ready.template) throw notReady(problems)
      const now = new Date()
      const later = c.scheduleAt && c.scheduleAt.getTime() > now.getTime() + 30_000
      const updated = await tx.campaign.update({
        where: { id },
        data: {
          status: later ? 'SCHEDULED' : 'PREPARING',
          templateSnapshot: ready.template as object,
          launchedBy: userId,
          launchedAt: now,
          ...(later ? {} : { scheduleAt: null }),
        },
      })
      if (!later) await this.emit(tx, tenantId, 'campaign.launched', id)
      await this.audit.write(tx, {
        action: later ? 'campaign.scheduled' : 'campaign.launched',
        targetType: 'campaign',
        targetId: id,
        changes: { scheduleAt: c.scheduleAt?.toISOString() ?? null },
      })
      return updated
    })
  }

  unschedule(id: string): Promise<Campaign> {
    return this.transition(id, async (tx, c) => {
      if (c.status !== 'SCHEDULED') throw invalidState(c.status, 'unscheduled')
      const updated = await tx.campaign.update({
        where: { id, status: 'SCHEDULED' },
        data: {
          status: 'DRAFT',
          templateSnapshot: Prisma.DbNull,
          launchedAt: null,
          launchedBy: null,
        },
      })
      await this.audit.write(tx, {
        action: 'campaign.unscheduled',
        targetType: 'campaign',
        targetId: id,
        changes: {},
      })
      return updated
    })
  }

  pause(id: string): Promise<Campaign> {
    return this.transition(id, async (tx, c) => {
      if (c.status !== 'RUNNING' && c.status !== 'PREPARING') throw invalidState(c.status, 'paused')
      const updated = await tx.campaign.update({
        where: { id },
        data: { status: 'PAUSED', pauseReason: 'MANUAL', pausedAt: new Date() },
      })
      await this.audit.write(tx, {
        action: 'campaign.paused',
        targetType: 'campaign',
        targetId: id,
        changes: {},
      })
      return updated
    })
  }

  /** Resume re-checks what paused it: funds (next recipient's estimate), template, number. */
  resume(id: string): Promise<Campaign> {
    const { tenantId } = currentTenant()
    return this.transition(id, async (tx, c) => {
      const resumable: CampaignStatus[] = [
        'PAUSED',
        'PAUSED_INSUFFICIENT_FUNDS',
        'PAUSED_TEMPLATE_UNAVAILABLE',
      ]
      if (!resumable.includes(c.status)) throw invalidState(c.status, 'resumed')
      // P9-D3: the campaign resumes only with the exact template version it started with.
      if (
        c.templateSnapshot &&
        c.templateVersionId !== (c.templateSnapshot as TemplateSnapshot).versionId
      )
        throw notReady([
          { code: 'TEMPLATE', message: 'This campaign’s template changed. Create a new campaign.' },
        ])
      const ready = await this.readiness(tx, c)
      const blocking = ready.problems.filter((p) => ['TEMPLATE', 'PHONE'].includes(p.code))
      if (blocking.length) throw notReady(blocking)
      if (await billingEnforcedFor(tx, tenantId, this.options.billing)) {
        const next = await tx.campaignRecipient.findFirst({
          where: { campaignId: id, status: 'PENDING' },
          orderBy: { id: 'asc' },
        })
        const snapshot = c.templateSnapshot as TemplateSnapshot | null
        if (next && snapshot) {
          const price = await unitPrice(tx, snapshot.category, countryOf(next.phoneE164))
          const w = await lockWallet(tx, tenantId, this.options.billing)
          if (price && availableOf(w) < price.customerPriceMinor)
            throw new AppError(
              'INSUFFICIENT_BALANCE',
              422,
              'Add credits before resuming this campaign.',
              {
                availableMinor: Number(availableOf(w)),
                requiredMinor: Number(price.customerPriceMinor),
                currency: w.currency,
              },
            )
        }
      }
      // PREPARING if the snapshot never finished; RUNNING otherwise. A new generation starts a
      // fresh dispatch chain.
      const updated = await tx.campaign.update({
        where: { id },
        data: {
          status: c.audienceSnapshotAt ? 'RUNNING' : 'PREPARING',
          pauseReason: null,
          dispatchGeneration: { increment: 1 },
        },
      })
      await this.emit(
        tx,
        tenantId,
        c.audienceSnapshotAt ? 'campaign.resumed' : 'campaign.launched',
        id,
      )
      await this.audit.write(tx, {
        action: 'campaign.resumed',
        targetType: 'campaign',
        targetId: id,
        changes: {},
      })
      return updated
    })
  }

  /** Cancel: terminal. Recipients not yet handed to MessagingService are SKIPPED (CANCELLED). */
  cancel(id: string): Promise<Campaign> {
    return this.transition(id, async (tx, c) => {
      const cancellable: CampaignStatus[] = [
        'SCHEDULED',
        'PREPARING',
        'RUNNING',
        'PAUSED',
        'PAUSED_INSUFFICIENT_FUNDS',
        'PAUSED_TEMPLATE_UNAVAILABLE',
      ]
      if (!cancellable.includes(c.status)) throw invalidState(c.status, 'cancelled')
      const now = new Date()
      const updated = await tx.campaign.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: now, pauseReason: null },
      })
      const skipped = await tx.campaignRecipient.updateMany({
        where: { campaignId: id, status: 'PENDING' },
        data: { status: 'SKIPPED', skipReason: 'CANCELLED' },
      })
      await this.audit.write(tx, {
        action: 'campaign.cancelled',
        targetType: 'campaign',
        targetId: id,
        changes: { skipped: skipped.count },
      })
      return updated
    })
  }

  // ------------------------------------------------------------------------------ helpers

  private async transition(
    id: string,
    fn: (tx: TenantTx, c: CampaignRow) => Promise<CampaignRow>,
  ): Promise<Campaign> {
    const { tenantId } = currentTenant()
    const result = await this.tenantDb.run(async (tx) => {
      const [locked] = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM campaigns WHERE id = ${id}::uuid AND deleted_at IS NULL FOR UPDATE`
      if (!locked) throw AppError.notFound('Campaign not found.')
      const updated = await fn(tx, await this.find(tx, id))
      return this.dto(tx, updated)
    })
    this.realtime.toTenant(tenantId, 'campaign.progress', { campaignId: id, status: result.status })
    return result
  }

  private async emit(
    tx: TenantTx,
    tenantId: string,
    eventType: 'campaign.launched' | 'campaign.resumed',
    id: string,
  ) {
    await tx.outboxEvent.create({
      data: {
        tenantId,
        eventType,
        aggregateType: 'campaign',
        aggregateId: id,
        payload: { campaignId: id },
      },
    })
  }

  /** What must be true to launch or resume; problems are user-facing. */
  private async readiness(
    tx: TenantTx,
    c: CampaignRow,
  ): Promise<{
    problems: Array<{ code: string; message: string }>
    template: TemplateSnapshot | null
  }> {
    const problems: Array<{ code: string; message: string }> = []
    const phone = c.phoneNumberId
      ? await tx.whatsAppPhoneNumber.findFirst({ where: { id: c.phoneNumberId } })
      : null
    if (!phone)
      problems.push({ code: 'PHONE', message: 'Choose the WhatsApp number to send from.' })
    else if (!['CONNECTED', 'FLAGGED'].includes(phone.status))
      problems.push({ code: 'PHONE', message: 'This WhatsApp number is not connected.' })
    let template: TemplateSnapshot | null = null
    const version = c.templateVersionId
      ? await tx.templateVersion.findFirst({
          where: { id: c.templateVersionId },
          include: { template: true },
        })
      : null
    if (!version || version.template.deletedAt)
      problems.push({ code: 'TEMPLATE', message: 'Choose an approved template.' })
    else if (
      version.status !== 'APPROVED' ||
      ['PAUSED', 'DISABLED', 'ARCHIVED'].includes(version.template.status)
    )
      problems.push({
        code: 'TEMPLATE',
        message: `The template ${version.template.name} is ${version.template.status === 'APPROVED' ? version.status.toLowerCase() : version.template.status.toLowerCase()} and can't be sent.`,
      })
    else if (phone && version.template.wabaId !== phone.wabaId)
      problems.push({
        code: 'TEMPLATE',
        message: 'This template belongs to another WhatsApp Business Account.',
      })
    else {
      template = {
        templateId: version.templateId,
        versionId: version.id,
        name: version.template.name,
        language: version.template.language,
        category: version.template.category as TemplateCategory,
        components: version.components as TemplateComponents,
      }
      const gaps = mappingGaps(template.components, c.variableMapping as VariableMapping)
      if (gaps.length && template.category !== 'AUTHENTICATION')
        problems.push({ code: 'MAPPING', message: 'Choose a value for every template variable.' })
    }
    if (!(c.audience as CampaignAudience).include?.length)
      problems.push({ code: 'AUDIENCE', message: 'Choose who receives the campaign.' })
    return { problems, template }
  }

  private async checkRefs(tx: TenantTx, input: Partial<CreateCampaign>) {
    if (input.phoneNumberId) {
      const p = await tx.whatsAppPhoneNumber.findFirst({ where: { id: input.phoneNumberId } })
      if (!p) throw AppError.notFound('WhatsApp number not found.')
    }
    if (input.templateVersionId) {
      const v = await tx.templateVersion.findFirst({ where: { id: input.templateVersionId } })
      if (!v) throw AppError.notFound('Template not found.')
    }
  }

  private async find(tx: TenantTx, id: string): Promise<CampaignRow> {
    const c = await tx.campaign.findFirst({ where: { id, deletedAt: null } })
    if (!c) throw AppError.notFound('Campaign not found.')
    return c
  }

  private async phoneDisplays(tx: TenantTx, rows: CampaignRow[]) {
    const ids = [...new Set(rows.map((r) => r.phoneNumberId).filter(Boolean))] as string[]
    const phones = ids.length
      ? await tx.whatsAppPhoneNumber.findMany({
          where: { id: { in: ids } },
          select: { id: true, displayPhoneNumber: true },
        })
      : []
    return new Map(phones.map((p) => [p.id, p.displayPhoneNumber]))
  }

  private async dto(tx: TenantTx, c: CampaignRow): Promise<Campaign> {
    const phones = await this.phoneDisplays(tx, [c])
    return toCampaign(c, phones.get(c.phoneNumberId ?? '') ?? null)
  }
}

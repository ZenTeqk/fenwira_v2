import {
  type AudienceSource,
  type Campaign,
  type CampaignAudience,
  type CampaignRecipient,
  type CampaignStats,
  type ContactFilter,
  missingVariables,
  requiredVariables,
  type SkipReason,
  type TemplateCategory,
  type TemplateComponents,
  type TemplateVariables,
  type VariableMapping,
  type VariableSource,
} from '@fenwira/contracts'
import { type Prisma, type TenantTx } from '@fenwira/database'
import { AppError } from '../../core/http/app-error'
import { normalizePhone } from '../../core/phone'
import { FilterCompiler } from '../contacts'
import { evaluateEligibility } from '../messaging'

/**
 * Campaign domain logic shared by the API (estimate, launch checks) and the worker (snapshot,
 * dispatch). docs/CAMPAIGN_ENGINE.md.
 */

type Where = Prisma.ContactWhereInput
/** Explicit match-all: Prisma silently drops `{}` inside OR (Phase 6 finding). */
const EVERYTHING: Where = { deletedAt: null }

async function sourceWhere(tx: TenantTx, s: AudienceSource): Promise<Where> {
  switch (s.kind) {
    case 'SEGMENT': {
      const segment = await tx.segment.findFirst({ where: { id: s.segmentId, deletedAt: null } })
      if (!segment)
        throw AppError.validation([
          {
            path: 'audience',
            code: 'unknown_segment',
            message: 'A chosen segment no longer exists.',
          },
        ])
      return new FilterCompiler(tx, { allowSegments: true }).compile(
        segment.filter as unknown as ContactFilter,
      )
    }
    case 'FILTER':
      return new FilterCompiler(tx, { allowSegments: true }).compile(s.filter)
    case 'TAGS':
      return s.match === 'ALL'
        ? { AND: s.tagIds.map((tagId) => ({ tags: { some: { tagId } } })) }
        : { tags: { some: { tagId: { in: s.tagIds } } } }
    case 'CONTACTS':
      return { id: { in: s.contactIds } }
    case 'IMPORT':
      return {
        activities: {
          some: {
            type: 'contact.imported',
            data: { path: ['importJobId'], equals: s.importJobId },
          },
        },
      }
  }
}

/** Include (union) minus exclude, live contacts only, optionally created before a cutoff. */
export async function audienceWhere(
  tx: TenantTx,
  audience: CampaignAudience,
  createdBefore?: Date,
): Promise<Where> {
  if (!audience.include.length) return { id: { in: [] } }
  const include = await Promise.all(audience.include.map((s) => sourceWhere(tx, s)))
  const exclude = await Promise.all(audience.exclude.map((s) => sourceWhere(tx, s)))
  return {
    AND: [
      EVERYTHING,
      { OR: include },
      ...(exclude.length ? [{ NOT: { OR: exclude } }] : []),
      ...(createdBefore ? [{ createdAt: { lte: createdBefore } }] : []),
    ],
  }
}

export const CONTACT_SELECT = {
  id: true,
  name: true,
  phoneE164: true,
  email: true,
  country: true,
  status: true,
  deletedAt: true,
  marketingConsent: true,
  utilityConsent: true,
  propertyValues: {
    select: {
      valueText: true,
      valueNumber: true,
      valueDate: true,
      valueBool: true,
      definition: { select: { key: true } },
    },
  },
} satisfies Prisma.ContactSelect
export type AudienceContact = Prisma.ContactGetPayload<{ select: typeof CONTACT_SELECT }>

/**
 * Keyset pages of the audience by contact id: memory stays bounded by `pageSize` no matter how
 * large the audience is (docs/CAMPAIGN_ENGINE.md → Launch, snapshot).
 */
export async function* audiencePages(
  tx: TenantTx,
  where: Where,
  pageSize = 1000,
  afterId?: string,
): AsyncGenerator<AudienceContact[]> {
  let cursor = afterId
  for (;;) {
    const page = await tx.contact.findMany({
      where: cursor ? { AND: [where, { id: { gt: cursor } }] } : where,
      select: CONTACT_SELECT,
      orderBy: { id: 'asc' },
      take: pageSize,
    })
    if (!page.length) return
    yield page
    cursor = page.at(-1)!.id
    if (page.length < pageSize) return
  }
}

function propertyValue(c: AudienceContact, key: string): string | undefined {
  const v = c.propertyValues.find((p) => p.definition.key === key)
  if (!v) return undefined
  if (v.valueText !== null) return v.valueText
  if (v.valueNumber !== null) return v.valueNumber.toString()
  if (v.valueDate !== null) return v.valueDate.toISOString().slice(0, 10)
  if (v.valueBool !== null) return v.valueBool ? 'Yes' : 'No'
  return undefined
}

function resolveSource(src: VariableSource | undefined, c: AudienceContact): string {
  if (!src) return ''
  if (src.kind === 'STATIC') return src.value
  let value: string | undefined
  if (src.kind === 'PROPERTY') value = propertyValue(c, src.key)
  else
    switch (src.field) {
      case 'name':
        value = c.name ?? undefined
        break
      case 'firstName':
        value = c.name?.trim().split(/\s+/)[0]
        break
      case 'phone':
        value = c.phoneE164
        break
      case 'email':
        value = c.email ?? undefined
        break
      case 'country':
        value = c.country ?? undefined
        break
    }
  return value?.trim() || src.fallback?.trim() || ''
}

/** A contact's values for the template, resolved from the mapping (stored on the recipient). */
export function resolveVariables(mapping: VariableMapping, c: AudienceContact): TemplateVariables {
  return {
    ...(mapping.header?.length ? { header: mapping.header.map((s) => resolveSource(s, c)) } : {}),
    body: mapping.body.map((s) => resolveSource(s, c)),
    ...(mapping.buttons
      ? {
          buttons: Object.fromEntries(
            Object.entries(mapping.buttons).map(([k, v]) => [k, v.map((s) => resolveSource(s, c))]),
          ),
        }
      : {}),
  }
}

/** Every template variable has a source (the mapping is complete). */
export function mappingGaps(components: TemplateComponents, mapping: VariableMapping): string[] {
  const need = requiredVariables(components)
  const gaps: string[] = []
  for (let i = 0; i < need.header; i++) if (!mapping.header?.[i]) gaps.push(`header.${i}`)
  for (let i = 0; i < need.body; i++) if (!mapping.body[i]) gaps.push(`body.${i}`)
  for (const [idx, n] of Object.entries(need.buttons))
    for (let i = 0; i < n; i++) if (!mapping.buttons?.[idx]?.[i]) gaps.push(`buttons.${idx}.${i}`)
  return gaps
}

/**
 * Snapshot-time classification: the same MessageEligibilityService rules the send applies
 * (no duplicated consent logic), plus phone validity and missing variables.
 */
export function classify(
  c: AudienceContact,
  template: { category: TemplateCategory; components: TemplateComponents },
  variables: TemplateVariables,
  defaultCountry: string,
): SkipReason | null {
  const phone = normalizePhone(c.phoneE164, defaultCountry)
  if (!phone.ok) return 'INVALID_PHONE'
  const decision = evaluateEligibility({
    purpose: template.category === 'MARKETING' ? 'MARKETING' : 'UTILITY',
    category: template.category,
    contentType: 'TEMPLATE',
    contact: c,
    serviceWindowExpiresAt: null,
  })
  if (!decision.allowed) return skipReasonFor(decision.code, decision.optedOut)
  if (
    template.category !== 'AUTHENTICATION' &&
    missingVariables(template.components, variables).length
  )
    return 'MISSING_VARIABLE'
  return null
}

/**
 * Maps an eligibility or send error to the recipient's skip reason. Whether a consent denial was
 * an explicit opt-out comes from MessageEligibilityService (`optedOut`), never from here.
 */
export function skipReasonFor(code: string, optedOut?: boolean): SkipReason {
  switch (code) {
    case 'CONTACT_BLOCKED':
      return 'BLOCKED'
    case 'CONSENT_REQUIRED':
      return optedOut ? 'OPTED_OUT' : 'NO_MARKETING_CONSENT'
    case 'TEMPLATE_VARIABLES_INVALID':
      return 'MISSING_VARIABLE'
    case 'TEMPLATE_NOT_APPROVED':
      return 'TEMPLATE_NOT_APPROVED'
    case 'INVALID_PHONE':
      return 'INVALID_PHONE'
    default:
      return 'OTHER_POLICY_RESTRICTION'
  }
}

// ------------------------------------------------------------------------------------ mappers

export const CAMPAIGN_INCLUDE = {
  templateVersion: { select: { id: true } },
} satisfies Prisma.CampaignInclude
type CampaignRow = Prisma.CampaignGetPayload<object>
const iso = (d: Date | null) => d?.toISOString() ?? null

export function toCampaign(c: CampaignRow, phoneDisplay: string | null): Campaign {
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    pauseReason: (c.pauseReason as Campaign['pauseReason']) ?? null,
    failureReason: c.failureReason,
    phoneNumberId: c.phoneNumberId,
    phoneNumberDisplay: phoneDisplay,
    templateVersionId: c.templateVersionId,
    template: (c.templateSnapshot as Campaign['template']) ?? null,
    audience: c.audience as CampaignAudience,
    variableMapping: c.variableMapping as VariableMapping,
    scheduleAt: iso(c.scheduleAt),
    timezone: c.timezone,
    rateLimitPerMinute: c.rateLimitPerMinute,
    totalRecipients: c.totalRecipients,
    audienceSnapshotAt: iso(c.audienceSnapshotAt),
    launchedAt: iso(c.launchedAt),
    startedAt: iso(c.startedAt),
    completedAt: iso(c.completedAt),
    cancelledAt: iso(c.cancelledAt),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }
}

export function toRecipient(r: Prisma.CampaignRecipientGetPayload<object>): CampaignRecipient {
  return {
    id: r.id,
    contactId: r.contactId,
    contactName: r.contactName,
    phoneE164: r.phoneE164,
    status: r.status,
    skipReason: (r.skipReason as CampaignRecipient['skipReason']) ?? null,
    errorCode: r.errorCode,
    messageId: r.messageId,
    variables: r.variables,
    queuedAt: iso(r.queuedAt),
    sentAt: iso(r.sentAt),
    deliveredAt: iso(r.deliveredAt),
    readAt: iso(r.readAt),
    failedAt: iso(r.failedAt),
  }
}

const rate = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 10_000) / 10_000 : null)

/**
 * Operational stats from grouped counts (indexed by campaign_id, status). Rates: delivery =
 * delivered or read / attempted (sent + failed); read = read / delivered or read; failure =
 * failed / attempted.
 */
export async function campaignStats(tx: TenantTx, campaign: CampaignRow): Promise<CampaignStats> {
  const [byStatus, bySkip, byError] = await Promise.all([
    tx.campaignRecipient.groupBy({
      by: ['status'],
      where: { campaignId: campaign.id },
      _count: { _all: true },
    }),
    tx.campaignRecipient.groupBy({
      by: ['skipReason'],
      where: { campaignId: campaign.id, status: 'SKIPPED' },
      _count: { _all: true },
    }),
    tx.campaignRecipient.groupBy({
      by: ['errorCode'],
      where: { campaignId: campaign.id, status: 'FAILED' },
      _count: { _all: true },
    }),
  ])
  const n = (s: string) => byStatus.find((x) => x.status === s)?._count._all ?? 0
  const read = n('READ')
  const delivered = n('DELIVERED') + read
  const sent = n('SENT') + delivered
  const failed = n('FAILED')
  const skipped = n('SKIPPED')
  const total = byStatus.reduce((t, x) => t + x._count._all, 0)
  const attempted = sent + failed
  const end = campaign.completedAt ?? campaign.cancelledAt ?? campaign.failedAt
  return {
    total,
    eligible: total - skipped,
    skipped,
    pending: n('PENDING'),
    queued: n('QUEUED') + n('SENDING'),
    sent,
    delivered,
    read,
    failed,
    deliveryRate: rate(delivered, attempted),
    readRate: rate(read, delivered),
    failureRate: rate(failed, attempted),
    skipReasons: Object.fromEntries(bySkip.map((x) => [x.skipReason ?? 'UNKNOWN', x._count._all])),
    failureCodes: Object.fromEntries(byError.map((x) => [x.errorCode ?? 'UNKNOWN', x._count._all])),
    durationSeconds:
      campaign.startedAt && end
        ? Math.round((end.getTime() - campaign.startedAt.getTime()) / 1000)
        : null,
  }
}

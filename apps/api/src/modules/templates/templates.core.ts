import {
  missingVariables,
  type Notification,
  type Template,
  type TemplateCategory,
  type TemplateComponents,
  type TemplateStatus,
  type TemplateVariables,
  type TemplateVersion,
  type VariableSamples,
} from '@fenwira/contracts'
import { type Prisma, type TenantTx } from '@fenwira/database'
import { buildTemplateSendComponents, templateStatusFromMeta } from '@fenwira/whatsapp'
import { AppError } from '../../core/http/app-error'
import { createNotification } from '../notifications'

/**
 * Template domain logic shared by the API service, the sync job, MessagingService (sends) and the
 * whatsapp.status processor (Meta events). docs/TEMPLATE_ENGINE.md.
 */

type VersionRow = Prisma.TemplateVersionGetPayload<object>
export const TEMPLATE_INCLUDE = {
  versions: { orderBy: { version: 'desc' as const } },
  waba: { select: { id: true, name: true } },
} satisfies Prisma.TemplateInclude
type TemplateRow = Prisma.TemplateGetPayload<{ include: typeof TEMPLATE_INCLUDE }>

export const toVersion = (v: VersionRow): TemplateVersion => ({
  id: v.id,
  version: v.version,
  status: v.status,
  components: v.components as TemplateComponents,
  samples: v.variableSamples as VariableSamples,
  metaTemplateId: v.metaTemplateId,
  origin: v.origin,
  rejectionReason: v.rejectionReason,
  lastError: v.lastError,
  qualityScore: v.qualityScore,
  submittedAt: v.submittedAt?.toISOString() ?? null,
  decidedAt: v.decidedAt?.toISOString() ?? null,
  createdAt: v.createdAt.toISOString(),
})

export function toTemplate(t: TemplateRow): Template {
  const current = t.versions.find((v) => v.id === t.currentVersionId) ?? t.versions[0]!
  return {
    id: t.id,
    wabaId: t.wabaId,
    wabaName: t.waba.name,
    name: t.name,
    language: t.language,
    category: t.category,
    status: t.status,
    qualityScore: t.qualityScore,
    currentVersion: toVersion(current),
    approvedVersionId: t.approvedVersionId,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  }
}

/** The latest version Meta knows (it carries the meta_template_id). */
export const submittedVersion = (versions: VersionRow[]) =>
  versions.find((v) => v.metaTemplateId) ?? null

// ------------------------------------------------------------------------------------- sends

export type ResolvedTemplate = {
  templateId: string
  versionId: string
  name: string
  language: string
  category: TemplateCategory
  /** Meta send components (parameters); a media header carries MEDIA_PLACEHOLDER. */
  components: unknown[]
  /** File to upload as the media header (sent file, or the version's sample). */
  headerFileId: string | null
}

/**
 * Resolves a TEMPLATE send against managed templates (MessagingService step 6): the template must
 * belong to the sending number's WABA and the version must be APPROVED; every variable is required.
 */
export async function resolveTemplateForSend(
  tx: TenantTx,
  input: {
    wabaRowId: string
    templateVersionId?: string
    name?: string
    language?: string
    variables?: TemplateVariables
    rawComponents?: unknown[]
  },
): Promise<ResolvedTemplate> {
  const notApproved = (message: string) => new AppError('TEMPLATE_NOT_APPROVED', 422, message)
  let version: VersionRow | null
  let template: Prisma.TemplateGetPayload<object> | null
  if (input.templateVersionId) {
    version = await tx.templateVersion.findFirst({ where: { id: input.templateVersionId } })
    template = version
      ? await tx.template.findFirst({ where: { id: version.templateId, deletedAt: null } })
      : null
  } else {
    template = await tx.template.findFirst({
      where: {
        wabaId: input.wabaRowId,
        name: input.name,
        language: input.language,
        deletedAt: null,
      },
    })
    version = template?.approvedVersionId
      ? await tx.templateVersion.findFirst({ where: { id: template.approvedVersionId } })
      : null
  }
  if (!template || !version)
    throw notApproved(
      input.name
        ? `There is no approved template ${input.name} (${input.language}) on this number. Sync templates from Meta, or create it.`
        : 'This template does not exist.',
    )
  if (template.wabaId !== input.wabaRowId)
    throw notApproved('This template belongs to another WhatsApp Business Account.')
  if (version.status !== 'APPROVED')
    throw notApproved(`This template is ${version.status.toLowerCase()} and can't be sent.`)

  const components = version.components as TemplateComponents
  let sendComponents: unknown[]
  if (input.rawComponents?.length && !input.templateVersionId) {
    sendComponents = input.rawComponents
  } else {
    const values: TemplateVariables = input.variables ?? { body: [] }
    const missing =
      template.category === 'AUTHENTICATION'
        ? values.body[0]?.trim()
          ? []
          : ['body.0']
        : missingVariables(components, values)
    if (missing.length)
      throw new AppError(
        'TEMPLATE_VARIABLES_INVALID',
        422,
        'Fill in every variable of the template.',
        { missing },
      )
    sendComponents = buildTemplateSendComponents(template.category, components, values)
  }
  const header = components.header
  const headerFileId =
    header && header.format !== 'TEXT'
      ? (input.variables?.headerFileId ?? version.sampleFileId ?? header.sampleFileId ?? null)
      : null
  if (header && header.format !== 'TEXT' && !headerFileId)
    throw new AppError(
      'TEMPLATE_VARIABLES_INVALID',
      422,
      'Choose a file for the template header.',
      {
        missing: ['headerFileId'],
      },
    )
  return {
    templateId: template.id,
    versionId: version.id,
    name: template.name,
    language: template.language,
    category: template.category,
    components: sendComponents,
    headerFileId,
  }
}

// ----------------------------------------------------------------------- status transitions

export type Push = { userId: string; notification: Notification }

/** Creator plus the workspace's owners and admins get an in-app notification per transition. */
async function notifyTransition(
  tx: TenantTx,
  tenantId: string,
  t: { id: string; name: string; language: string; createdBy: string | null },
  title: string,
  body: string,
  severity: 'INFO' | 'WARNING' | 'CRITICAL',
): Promise<Push[]> {
  const admins = await tx.membership.findMany({
    where: { status: 'ACTIVE', role: { in: ['OWNER', 'ADMIN'] } },
    select: { userId: true },
  })
  const users = new Set([...admins.map((a) => a.userId), ...(t.createdBy ? [t.createdBy] : [])])
  const pushes: Push[] = []
  for (const userId of users)
    pushes.push({
      userId,
      notification: await createNotification(tx, {
        tenantId,
        userId,
        type: 'template.status.changed',
        title,
        body,
        severity,
        link: `/templates/${t.id}`,
      }),
    })
  return pushes
}

const TITLES: Partial<Record<TemplateStatus, [string, 'INFO' | 'WARNING' | 'CRITICAL']>> = {
  APPROVED: ['approved', 'INFO'],
  REJECTED: ['rejected', 'WARNING'],
  PAUSED: ['paused by Meta', 'WARNING'],
  DISABLED: ['disabled by Meta', 'CRITICAL'],
}

/**
 * Moves one version to `to` and keeps the template consistent: the template's status mirrors its
 * current version, `approved_version_id` advances only on approval (an older approved version stays
 * usable while a newer one is reviewed), and pause/disable apply to what Meta serves.
 */
export async function transitionVersion(
  tx: TenantTx,
  tenantId: string,
  versionId: string,
  to: TemplateStatus,
  extra: { rejectionReason?: string | null; qualityScore?: string | null } = {},
): Promise<Push[]> {
  const version = await tx.templateVersion.findFirstOrThrow({ where: { id: versionId } })
  const template = await tx.template.findFirstOrThrow({ where: { id: version.templateId } })
  const from = version.status
  if (from === to && extra.qualityScore === undefined) return []
  const now = new Date()
  await tx.templateVersion.update({
    where: { id: version.id },
    data: {
      status: to,
      ...(to !== from && ['APPROVED', 'REJECTED'].includes(to) ? { decidedAt: now } : {}),
      ...(extra.rejectionReason !== undefined ? { rejectionReason: extra.rejectionReason } : {}),
      ...(extra.qualityScore !== undefined ? { qualityScore: extra.qualityScore } : {}),
    },
  })
  const data: Prisma.TemplateUpdateInput = {}
  if (to === 'APPROVED') {
    // Meta now serves this content: older approved versions are superseded.
    await tx.templateVersion.updateMany({
      where: { templateId: template.id, status: 'APPROVED', NOT: { id: version.id } },
      data: { status: 'ARCHIVED' },
    })
    data.approvedVersionId = version.id
  }
  // The template's status mirrors its current version; pause/disable hit what Meta serves.
  if (template.currentVersionId === version.id || to === 'PAUSED' || to === 'DISABLED')
    data.status = to
  if (extra.qualityScore !== undefined) data.qualityScore = extra.qualityScore
  await tx.template.update({ where: { id: template.id }, data })
  if (from === to) return []
  await tx.outboxEvent.create({
    data: {
      tenantId,
      eventType: 'template.status.changed',
      aggregateType: 'template',
      aggregateId: template.id,
      payload: { templateId: template.id, versionId: version.id, from, to },
    },
  })
  const title = TITLES[to]
  if (!title) return []
  const reason =
    to === 'REJECTED' && extra.rejectionReason ? ` Reason: ${extra.rejectionReason}.` : ''
  return notifyTransition(
    tx,
    tenantId,
    template,
    `Template ${template.name} ${title[0]}`,
    `${template.name} (${template.language}) version ${version.version} was ${title[0]}.${reason}`,
    title[1],
  )
}

/** Meta's webhook data for a template event (docs/META_INTEGRATION.md → Webhooks). */
export type TemplateEvent = {
  kind: 'TEMPLATE_STATUS' | 'TEMPLATE_QUALITY' | 'TEMPLATE_CATEGORY'
  data: Record<string, unknown>
}

/**
 * Applies a `message_template_*` webhook (routed by whatsapp.status). Unknown templates are
 * ignored (a sync imports them). Returns notifications to push after commit.
 */
export async function applyTemplateEvent(
  tx: TenantTx,
  tenantId: string,
  event: TemplateEvent,
): Promise<{ applied: boolean; pushes: Push[] }> {
  const metaId = String(event.data.message_template_id ?? '')
  if (!metaId) return { applied: false, pushes: [] }
  // The newest version Meta knows by this id (an edit under review, else the approved one).
  const version = await tx.templateVersion.findFirst({
    where: { metaTemplateId: metaId },
    orderBy: { version: 'desc' },
  })
  if (!version) return { applied: false, pushes: [] }

  if (event.kind === 'TEMPLATE_QUALITY') {
    const score = String(event.data.new_quality_score ?? 'UNKNOWN')
    return {
      applied: true,
      pushes: await transitionVersion(tx, tenantId, version.id, version.status, {
        qualityScore: score,
      }),
    }
  }
  const template = await tx.template.findFirstOrThrow({ where: { id: version.templateId } })
  if (event.kind === 'TEMPLATE_CATEGORY') {
    const next = String(event.data.new_category ?? '').toUpperCase()
    if (!['MARKETING', 'UTILITY', 'AUTHENTICATION'].includes(next) || next === template.category)
      return { applied: false, pushes: [] }
    await tx.template.update({
      where: { id: template.id },
      data: { category: next as TemplateCategory },
    })
    return {
      applied: true,
      pushes: await notifyTransition(
        tx,
        tenantId,
        template,
        `Template ${template.name} re-categorized`,
        `Meta changed ${template.name} (${template.language}) from ${template.category} to ${next}. Consent rules for ${next} now apply.`,
        'WARNING',
      ),
    }
  }
  const to = templateStatusFromMeta(String(event.data.event ?? ''))
  const reason = String(event.data.reason ?? '')
  // Approve/reject decide the version under review; pause/disable/reinstate act on the version
  // Meta serves (the approved one), even while an edit is pending.
  const target =
    version.status === 'PENDING' && (to === 'APPROVED' || to === 'REJECTED')
      ? version.id
      : (template.approvedVersionId ?? version.id)
  return {
    applied: true,
    pushes: await transitionVersion(tx, tenantId, target, to, {
      rejectionReason:
        to === 'REJECTED' ? (reason && reason !== 'NONE' ? reason : 'Rejected by Meta') : undefined,
    }),
  }
}

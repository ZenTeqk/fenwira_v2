import {
  type TemplateCategory,
  type TemplateComponents,
  type TemplateStatus,
} from '@fenwira/contracts'
import { Database, type TenantTx } from '@fenwira/database'
import {
  fromMetaTemplate,
  GraphClient,
  type MetaTemplate,
  templateCategoryFromMeta,
  templateStatusFromMeta,
} from '@fenwira/whatsapp'
import { Inject, Injectable } from '@nestjs/common'
import { RealtimeEmitter } from '../../core/realtime/realtime-emitter'
import { loadLiveToken } from '../whatsapp-accounts'
import { type Push, transitionVersion } from './templates.core'
import { TEMPLATES_GRAPH, TEMPLATES_OPTIONS, type TemplatesOptions } from './templates.options'

export type SyncResult = { wabaId: string; imported: number; updated: number; missing: number }

/** Content Meta and Fenwira both hold, ignoring what Meta can't return (sample file ids). */
function comparable(c: TemplateComponents, category: TemplateCategory): string {
  if (category === 'AUTHENTICATION')
    return JSON.stringify({ auth: c.auth?.securityRecommendation ?? false })
  const header =
    c.header?.format === 'TEXT'
      ? { format: 'TEXT', text: c.header.text }
      : c.header
        ? { format: c.header.format }
        : null
  return JSON.stringify({
    header,
    body: c.body.text,
    footer: c.footer?.text ?? null,
    buttons: c.buttons ?? [],
  })
}

/**
 * Sync from Meta (docs/TEMPLATE_ENGINE.md → Sync from Meta): imports templates created outside
 * Fenwira, reconciles statuses and quality, and records content edited in WhatsApp Manager as a
 * new version marked as Meta-originated. Used by `POST /templates/sync` and the templates.sync job.
 */
@Injectable()
export class TemplateSyncService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(TEMPLATES_OPTIONS) private readonly options: TemplatesOptions,
    @Inject(TEMPLATES_GRAPH) private readonly graph: GraphClient,
    private readonly realtime: RealtimeEmitter,
  ) {}

  async syncWaba(tenantId: string, wabaRowId: string): Promise<SyncResult | null> {
    const loaded = await this.db.withTenant(tenantId, async (tx) => {
      const waba = await tx.whatsAppBusinessAccount.findFirst({ where: { id: wabaRowId } })
      const token = waba ? await loadLiveToken(tx, this.options.keyRing, waba.id) : null
      return waba && token ? { metaWabaId: waba.wabaId, token: token.token } : null
    })
    if (!loaded) return null
    const remote: MetaTemplate[] = []
    let after: string | undefined
    do {
      const page = await this.graph.listTemplates(loaded.token, loaded.metaWabaId, after)
      remote.push(...page.data)
      after = page.after
    } while (after && remote.length < 10_000)

    const { result, pushes } = await this.db.withTenant(tenantId, (tx) =>
      this.reconcile(tx, tenantId, wabaRowId, remote),
    )
    for (const p of pushes) this.realtime.toUser(p.userId, 'notification.created', p.notification)
    return result
  }

  private async reconcile(
    tx: TenantTx,
    tenantId: string,
    wabaRowId: string,
    remote: MetaTemplate[],
  ) {
    // One sync per WABA at a time (connect-triggered and manual syncs can overlap): the second
    // waits here, then sees what the first imported.
    await tx.$queryRaw`SELECT id FROM whatsapp_business_accounts WHERE id = ${wabaRowId}::uuid FOR UPDATE`
    const result: SyncResult = { wabaId: wabaRowId, imported: 0, updated: 0, missing: 0 }
    const pushes: Push[] = []
    const now = new Date()
    for (const m of remote) {
      const status = templateStatusFromMeta(m.status)
      const category = templateCategoryFromMeta(m.category)
      const { components, samples } = fromMetaTemplate(m)
      const quality = m.quality_score?.score ?? null
      const decided = status === 'APPROVED' || status === 'REJECTED' ? now : null
      const existing = await tx.template.findFirst({
        where: { wabaId: wabaRowId, name: m.name, language: m.language, deletedAt: null },
        include: { versions: { orderBy: { version: 'desc' } } },
      })
      const versionData = (version: number, templateId: string) => ({
        tenantId,
        templateId,
        version,
        components: components as object,
        variableSamples: samples as object,
        metaTemplateId: m.id,
        status,
        origin: 'META' as const,
        qualityScore: quality,
        rejectionReason: status === 'REJECTED' ? (m.rejected_reason ?? 'Rejected by Meta') : null,
        submittedAt: now,
        decidedAt: decided,
      })
      if (!existing) {
        const template = await tx.template.create({
          data: {
            tenantId,
            wabaId: wabaRowId,
            name: m.name,
            language: m.language,
            category,
            status,
            qualityScore: quality,
          },
        })
        const v = await tx.templateVersion.create({ data: versionData(1, template.id) })
        await tx.template.update({
          where: { id: template.id },
          data: { currentVersionId: v.id, approvedVersionId: status === 'APPROVED' ? v.id : null },
        })
        result.imported += 1
        continue
      }
      const known = existing.versions.find((v) => v.metaTemplateId === m.id)
      if (category !== existing.category)
        await tx.template.update({ where: { id: existing.id }, data: { category } })
      const sameContent =
        known &&
        (known.status === 'PENDING' ||
          comparable(known.components as TemplateComponents, category) ===
            comparable(components, category))
      if (known && sameContent) {
        const target =
          known.status === 'PENDING' && status !== 'APPROVED' && status !== 'REJECTED'
            ? (existing.approvedVersionId ?? known.id)
            : known.id
        const before = pushes.length
        pushes.push(
          ...(await transitionVersion(tx, tenantId, target, status as TemplateStatus, {
            qualityScore: quality,
            ...(status === 'REJECTED'
              ? { rejectionReason: m.rejected_reason ?? 'Rejected by Meta' }
              : {}),
          })),
        )
        if (pushes.length > before || known.status !== status) result.updated += 1
        continue
      }
      // Edited (or created) in WhatsApp Manager: a new version marked as Meta-originated.
      const next = (existing.versions[0]?.version ?? 0) + 1
      const v = await tx.templateVersion.create({ data: versionData(next, existing.id) })
      if (status === 'APPROVED')
        await tx.templateVersion.updateMany({
          where: { templateId: existing.id, status: 'APPROVED', NOT: { id: v.id } },
          data: { status: 'ARCHIVED' },
        })
      await tx.template.update({
        where: { id: existing.id },
        data: {
          currentVersionId: v.id,
          status,
          qualityScore: quality,
          ...(status === 'APPROVED' ? { approvedVersionId: v.id } : {}),
        },
      })
      result.updated += 1
    }
    // Submitted templates Meta no longer has were deleted outside Fenwira.
    const remoteIds = new Set(remote.map((m) => m.id))
    const orphans = await tx.template.findMany({
      where: { wabaId: wabaRowId, deletedAt: null, status: { not: 'DISABLED' } },
      include: {
        versions: {
          where: { metaTemplateId: { not: null } },
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    })
    for (const t of orphans) {
      const v = t.versions[0]
      if (!v || remoteIds.has(v.metaTemplateId!)) continue
      await tx.templateVersion.update({
        where: { id: v.id },
        data: { lastError: 'Deleted in WhatsApp Manager' },
      })
      pushes.push(
        ...(await transitionVersion(tx, tenantId, t.approvedVersionId ?? v.id, 'DISABLED')),
      )
      result.missing += 1
    }
    await tx.whatsAppBusinessAccount.update({
      where: { id: wabaRowId },
      data: { templatesSyncedAt: now },
    })
    return { result, pushes }
  }
}

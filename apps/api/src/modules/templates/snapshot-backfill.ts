import {
  messageContentSchema,
  renderTemplateSnapshot,
  type TemplateCategory,
  type TemplateComponents,
  type MessageTemplateSnapshot,
  templateVariablesSchema,
  variablesFromMetaComponents,
} from '@fenwira/contracts'
import { type Database, Prisma, type TenantTx } from '@fenwira/database'

/**
 * Rebuilds the template snapshot of TEMPLATE messages stored before snapshots existed
 * (docs/MESSAGING_ENGINE.md → Template snapshot). Idempotent (only rows still without one),
 * batched (one transaction per batch), and it never fails on a message: whatever can't be resolved
 * is left out and the snapshot is marked partial.
 */
export type BackfillResult = { tenants: number; messages: number; partial: number }

type Row = {
  id: string
  content: Prisma.JsonValue
  templateVersionId: string | null
  fileId: string | null
}

/** One message: the exact version sent, else the template's approved version (marked partial). */
export async function snapshotForStoredMessage(tx: TenantTx, m: Row): Promise<MessageTemplateSnapshot> {
  const parsed = messageContentSchema.safeParse(m.content)
  const content = parsed.success && parsed.data.type === 'TEMPLATE' ? parsed.data : null
  const name = content?.name ?? 'unknown'
  const language = content?.language ?? 'unknown'
  const extraMissing: string[] = []

  let components: TemplateComponents | null = null
  let category: TemplateCategory | null = content?.category ?? null
  const versionId = m.templateVersionId ?? content?.templateVersionId ?? null
  const version = versionId
    ? await tx.templateVersion.findFirst({ where: { id: versionId } })
    : null
  if (version) {
    components = version.components as TemplateComponents
    const template = await tx.template.findFirst({ where: { id: version.templateId } })
    category ??= template?.category ?? null
  } else if (content) {
    const template = await tx.template.findFirst({
      where: { name, language, deletedAt: null, approvedVersionId: { not: null } },
      orderBy: { createdAt: 'desc' },
    })
    const approved = template?.approvedVersionId
      ? await tx.templateVersion.findFirst({ where: { id: template.approvedVersionId } })
      : null
    if (template && approved) {
      components = approved.components as TemplateComponents
      category ??= template.category
      // Rendered from today's version, not necessarily the one that was sent.
      extraMissing.push('version')
    }
  }

  const sent = templateVariablesSchema.safeParse(content?.variables)
  const values = sent.success ? sent.data : variablesFromMetaComponents(content?.components)
  const file = m.fileId
    ? await tx.file.findFirst({
        where: { id: m.fileId },
        select: { id: true, filename: true, mimeType: true },
      })
    : null
  const snapshot = renderTemplateSnapshot({
    name,
    language,
    category,
    components,
    values,
    headerFile: file,
  })
  if (!content) extraMissing.push('content')
  return extraMissing.length
    ? { ...snapshot, partial: true, missing: [...extraMissing, ...snapshot.missing] }
    : snapshot
}

/** The fallback when even rendering throws: name and language only. */
function minimalSnapshot(m: Row): MessageTemplateSnapshot {
  const c = m.content as { name?: unknown; language?: unknown } | null
  return {
    v: 1,
    name: typeof c?.name === 'string' ? c.name : 'unknown',
    language: typeof c?.language === 'string' ? c.language : 'unknown',
    category: null,
    header: null,
    body: null,
    footer: null,
    buttons: [],
    variables: { body: [] },
    partial: true,
    missing: ['template'],
  }
}

export async function backfillTenantTemplateSnapshots(
  db: Database,
  tenantId: string,
  batchSize = 200,
): Promise<{ messages: number; partial: number }> {
  let after: string | null = null
  let messages = 0
  let partial = 0
  for (;;) {
    const done: { rows: number; partial: number; last: string | null } = await db.withTenant(
      tenantId,
      async (tx) => {
        const rows = await tx.message.findMany({
          where: {
            type: 'TEMPLATE',
            templateSnapshot: { equals: Prisma.DbNull },
            ...(after ? { id: { gt: after } } : {}),
          },
          select: { id: true, content: true, templateVersionId: true, fileId: true },
          orderBy: { id: 'asc' },
          take: batchSize,
        })
        let batchPartial = 0
        for (const row of rows) {
          let snapshot: MessageTemplateSnapshot
          try {
            snapshot = await snapshotForStoredMessage(tx, row)
          } catch {
            snapshot = minimalSnapshot(row)
          }
          if (snapshot.partial) batchPartial++
          // Guarded on NULL: a concurrent run or a newer send never gets overwritten.
          await tx.message.updateMany({
            where: { id: row.id, templateSnapshot: { equals: Prisma.DbNull } },
            data: { templateSnapshot: snapshot as Prisma.InputJsonValue },
          })
        }
        return { rows: rows.length, partial: batchPartial, last: rows.at(-1)?.id ?? null }
      },
      { timeoutMs: 60_000 },
    )
    messages += done.rows
    partial += done.partial
    if (done.rows < batchSize || !done.last) return { messages, partial }
    after = done.last
  }
}

/** Every workspace with snapshot-less template messages (or just `tenantId`). */
export async function backfillTemplateSnapshots(
  db: Database,
  opts: { tenantId?: string; batchSize?: number } = {},
): Promise<BackfillResult> {
  const result: BackfillResult = { tenants: 0, messages: 0, partial: 0 }
  const run = async (tenantId: string) => {
    const r = await backfillTenantTemplateSnapshots(db, tenantId, opts.batchSize)
    result.tenants++
    result.messages += r.messages
    result.partial += r.partial
  }
  if (opts.tenantId) {
    await run(opts.tenantId)
    return result
  }
  let after: string | null = null
  for (;;) {
    const ids = await db.system.tenantsMissingTemplateSnapshots(100, after)
    for (const id of ids) await run(id)
    if (ids.length < 100) return result
    after = ids.at(-1)!
  }
}

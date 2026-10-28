import { type AiConfig, type Chunk, type HistoryTurn, type RetrievedChunk } from '@fenwira/ai'
import { type AiKnowledgeSource, type AiReplyLog, type AiSettings } from '@fenwira/contracts'
import { uuidv7 } from '@fenwira/config'
import { type Prisma, type TenantTx } from '@fenwira/database'

/**
 * AI Assistant data helpers (docs/AI_ASSISTANT.md). Everything runs inside the caller's tenant
 * transaction; queries also filter by tenant explicitly, so isolation never rests on RLS alone.
 */

export type SettingsRow = Prisma.AiSettingsGetPayload<object>

export const DEFAULT_FALLBACK =
  "Sorry, I couldn't find the answer to that in our information. Could you rephrase your question?"

export async function loadSettings(tx: TenantTx, tenantId: string): Promise<SettingsRow | null> {
  return tx.aiSettings.findFirst({ where: { tenantId } })
}

export function toSettings(row: SettingsRow | null): AiSettings {
  return {
    enabled: row?.enabled ?? false,
    monthlyMessageQuota: row?.monthlyMessageQuota ?? 0,
    businessName: row?.businessName ?? null,
    businessDescription: row?.businessDescription ?? null,
    tone: row?.tone ?? 'FRIENDLY',
    fallbackMessage: row?.fallbackMessage ?? null,
    handoffMessage: row?.handoffMessage ?? null,
  }
}

/** First instant of the current calendar month (UTC): the quota period. */
export const monthStart = (now = new Date()) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))

/** AI replies counted against the quota this month (model calls; see AI_ASSISTANT.md → Quota). */
export async function quotaUsed(tx: TenantTx, tenantId: string, now = new Date()): Promise<number> {
  return tx.aiReplyLog.count({
    where: { tenantId, billable: true, createdAt: { gte: monthStart(now) } },
  })
}

export async function quotaState(tx: TenantTx, tenantId: string, now = new Date()) {
  const [settings, used] = await Promise.all([
    loadSettings(tx, tenantId),
    quotaUsed(tx, tenantId, now),
  ])
  const quota = settings?.monthlyMessageQuota ?? 0
  return { used, quota, available: used < quota }
}

const toVector = (v: number[]) => `[${v.map((x) => (Number.isFinite(x) ? x : 0)).join(',')}]`

/**
 * Exact cosine search over the workspace's active chunks (no ANN index; AI_ASSISTANT.md →
 * Retrieval). Filtered by tenant in the query and by RLS; rows of another embedding dimension
 * (an older model) are skipped instead of compared.
 */
export async function searchChunks(
  tx: TenantTx,
  tenantId: string,
  vector: number[],
  limit: number,
  dimension: number,
): Promise<RetrievedChunk[]> {
  const v = toVector(vector)
  return tx.$queryRaw<RetrievedChunk[]>`
    SELECT c.id, c.source_id AS "sourceId", s.title, c.page, c.content,
           (1 - (c.embedding <=> ${v}::vector))::float8 AS similarity
    FROM ai_knowledge_chunks c
    JOIN ai_knowledge_sources s
      ON s.id = c.source_id AND s.tenant_id = c.tenant_id AND s.active_generation = c.generation
    WHERE c.tenant_id = ${tenantId}::uuid AND s.tenant_id = ${tenantId}::uuid
      AND vector_dims(c.embedding) = ${dimension}::integer
    ORDER BY c.embedding <=> ${v}::vector
    LIMIT ${limit}::integer`
}

/** Inserts one generation's chunks in a single statement. */
export async function insertChunks(
  tx: TenantTx,
  tenantId: string,
  sourceId: string,
  generation: number,
  chunks: Chunk[],
  vectors: number[][],
): Promise<void> {
  if (!chunks.length) return
  const ids = chunks.map(() => uuidv7())
  const ordinals = chunks.map((c) => c.ordinal)
  const contents = chunks.map((c) => c.content)
  const pages = chunks.map((c) => c.page)
  const embeddings = vectors.map(toVector)
  await tx.$executeRaw`
    INSERT INTO ai_knowledge_chunks (id, tenant_id, source_id, generation, ordinal, content, page, embedding)
    SELECT id, ${tenantId}::uuid, ${sourceId}::uuid, ${generation}::integer, ordinal, content, page, embedding::vector
    FROM unnest(${ids}::uuid[], ${ordinals}::integer[], ${contents}::text[], ${pages}::integer[], ${embeddings}::text[])
      AS t(id, ordinal, content, page, embedding)`
}

/** Text a message carries (text, caption, or a button/list reply). */
export function textOf(content: unknown): string {
  const c = (content ?? {}) as Record<string, unknown>
  for (const k of ['text', 'caption', 'title', 'payload'])
    if (typeof c[k] === 'string') return c[k] as string
  return ''
}

/** The last `n` text turns of a conversation before `beforeMessageId` (oldest first). */
export async function conversationHistory(
  tx: TenantTx,
  conversationId: string,
  before: Date,
  n: number,
): Promise<HistoryTurn[]> {
  if (n <= 0) return []
  const rows = await tx.message.findMany({
    where: {
      conversationId,
      direction: { in: ['INBOUND', 'OUTBOUND'] },
      createdAt: { lt: before },
    },
    orderBy: { createdAt: 'desc' },
    take: n,
    select: { direction: true, content: true },
  })
  return rows
    .reverse()
    .map((m) => ({
      from: m.direction === 'INBOUND' ? ('customer' as const) : ('business' as const),
      text: textOf(m.content),
    }))
    .filter((t) => t.text.trim())
}

export function toSource(
  s: Prisma.AiKnowledgeSourceGetPayload<object>,
  file?: { filename: string | null; mimeType: string } | null,
): AiKnowledgeSource {
  return {
    id: s.id,
    type: s.type,
    title: s.title,
    status: s.status,
    failureReason: s.failureReason,
    chunkCount: s.chunkCount,
    sizeBytes: Number(s.sizeBytes),
    fileName: file?.filename ?? null,
    mimeType: file?.mimeType ?? null,
    replacing: s.status === 'PROCESSING' && s.activeGeneration > 0,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  }
}

type StoredSource = { documentTitle: string; page: number | null; snippet: string }

export function toReplyLog(r: Prisma.AiReplyLogGetPayload<object>): AiReplyLog {
  return {
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    conversationId: r.conversationId,
    customerExcerpt: r.customerMessageExcerpt,
    outcome: r.outcome,
    reply: r.reply,
    sources: ((r.sources as { items?: StoredSource[] } | null)?.items ?? []).map((s) => ({
      documentTitle: s.documentTitle,
      page: s.page,
      snippet: s.snippet,
    })),
    playground: r.playground,
  }
}

/** Does the workspace have anything to answer from? (publish gate, readiness checklist) */
export async function readySourceCount(tx: TenantTx, tenantId: string): Promise<number> {
  return tx.aiKnowledgeSource.count({ where: { tenantId, activeGeneration: { gt: 0 } } })
}

export const excerptOf = (text: string) => (text.length > 280 ? `${text.slice(0, 280)}…` : text)

export type { AiConfig }

import { type AiConfig } from '@fenwira/ai'
import { uuidv7 } from '@fenwira/config'
import {
  AI_KNOWLEDGE_MIME_TYPES,
  type AiKnowledgeSource,
  type AiKnowledgeUploadUrlRequest,
  type AiOverview,
  type AiPlaygroundResponse,
  type AiReplyLog,
  type AiSettings,
  type AiUsage,
  type CreateAiFaqSourceRequest,
  type CreateAiFileSourceRequest,
  type CreateAiTextSourceRequest,
  type ReplaceAiSourceRequest,
  type UpdateAiSettingsRequest,
} from '@fenwira/contracts'
import { type Prisma, type TenantTx } from '@fenwira/database'
import { Inject, Injectable } from '@nestjs/common'
import { TenantDb } from '../../core/database/tenant-db'
import { AppError } from '../../core/http/app-error'
import { RateLimitService } from '../../core/security/rate-limit.service'
import { StorageService } from '../../core/storage/storage.service'
import { verifyUpload } from '../../core/storage/uploads'
import { AuditService } from '../audit'
import { currentAuth } from '../identity'
import { currentTenant } from '../tenancy'
import { AiAnswerService, playgroundText } from './ai-answer.service'
import {
  loadSettings,
  monthStart,
  quotaUsed,
  readySourceCount,
  toReplyLog,
  toSettings,
  toSource,
} from './ai.core'
import { AI_CONFIG } from './ai.options'

/** DOCX is a ZIP container: the upload must start with the local-file-header magic. */
const ZIP_MAGIC = Buffer.from('504b0304', 'hex')

/**
 * AI Assistant API (docs/API_SPEC.md → AI Assistant). Every route requires the workspace's
 * operator-controlled `enabled` flag; otherwise AI_NOT_ENABLED (403). Knowledge changes are
 * audited and queued through the outbox (ai.ingest).
 */
@Injectable()
export class AiService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly limits: RateLimitService,
    private readonly answers: AiAnswerService,
    @Inject(AI_CONFIG) private readonly config: AiConfig,
  ) {}

  // ------------------------------------------------------------------------------ overview

  overview(): Promise<AiOverview> {
    const { tenantId } = currentTenant()
    return this.run(async (tx, settings) => {
      const [ready, phones, used, flow, faqs] = await Promise.all([
        readySourceCount(tx, tenantId),
        tx.whatsAppPhoneNumber.count({ where: { status: { in: ['CONNECTED', 'FLAGGED'] } } }),
        quotaUsed(tx, tenantId),
        settings.managedFlowId
          ? tx.flow.findFirst({
              where: { id: settings.managedFlowId, deletedAt: null },
              select: { id: true, status: true },
            })
          : null,
        tx.aiKnowledgeSource.findMany({
          where: { tenantId, type: 'FAQ', activeGeneration: { gt: 0 } },
          orderBy: { createdAt: 'desc' },
          take: 3,
          select: { body: true },
        }),
      ])
      const sampleQuestions = faqs
        .flatMap((f) => ((f.body as { pairs?: Array<{ question: string }> })?.pairs ?? []).slice(0, 3))
        .map((p) => p.question)
        .slice(0, 4)
      return {
        enabled: true,
        readiness: {
          knowledge: ready > 0,
          businessInfo: Boolean(settings.businessName?.trim()),
          whatsapp: phones > 0,
          quota: used < settings.monthlyMessageQuota,
        },
        usage: { used, quota: settings.monthlyMessageQuota },
        managedFlow: flow,
        sampleQuestions,
      }
    })
  }

  // ------------------------------------------------------------------------------ settings

  settings(): Promise<AiSettings> {
    return this.run(async (_tx, settings) => toSettings(settings))
  }

  updateSettings(input: UpdateAiSettingsRequest): Promise<AiSettings> {
    const { tenantId } = currentTenant()
    const { userId } = currentAuth()
    return this.run(async (tx) => {
      const row = await tx.aiSettings.update({
        where: { tenantId },
        data: { ...input, updatedBy: userId },
      })
      await this.audit.write(tx, {
        action: 'ai.settings_updated',
        targetType: 'ai_settings',
        targetId: tenantId,
        changes: { fields: Object.keys(input) },
      })
      return toSettings(row)
    })
  }

  // ------------------------------------------------------------------------------ knowledge

  sources(): Promise<AiKnowledgeSource[]> {
    const { tenantId } = currentTenant()
    return this.run(async (tx) => {
      const rows = await tx.aiKnowledgeSource.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 500,
      })
      const files = await this.filesOf(tx, rows)
      return rows.map((r) => toSource(r, r.fileId ? files.get(r.fileId) : null))
    })
  }

  source(id: string): Promise<AiKnowledgeSource & { body: unknown }> {
    return this.run(async (tx) => {
      const row = await this.find(tx, id)
      const files = await this.filesOf(tx, [row])
      return { ...toSource(row, row.fileId ? files.get(row.fileId) : null), body: row.body }
    })
  }

  async uploadUrl(input: AiKnowledgeUploadUrlRequest) {
    const { tenantId } = currentTenant()
    if (input.sizeBytes > this.config.maxUploadBytes)
      throw AppError.validation(
        [
          {
            path: 'sizeBytes',
            code: 'too_big',
            message: `Files can be up to ${Math.floor(this.config.maxUploadBytes / 1048576)} MB.`,
          },
        ],
        'This file is too large.',
      )
    const id = uuidv7()
    const objectKey = `${tenantId}/ai-knowledge/${id}`
    const bucket = this.storage.importsBucket
    await this.run(async (tx) => {
      await this.assertRoom(tx, tenantId)
      await tx.file.create({
        data: {
          id,
          tenantId,
          bucket,
          objectKey,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          filename: input.filename,
          purpose: 'AI_KNOWLEDGE',
          uploadedBy: currentAuth().userId,
        },
      })
    })
    const expiresIn = 900
    const url = await this.storage.presignPut(
      bucket,
      objectKey,
      input.mimeType,
      input.sizeBytes,
      expiresIn,
    )
    return {
      fileId: id,
      url,
      headers: { 'Content-Type': input.mimeType },
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    }
  }

  async addFile(input: CreateAiFileSourceRequest): Promise<AiKnowledgeSource> {
    const file = await this.readyFile(input.fileId)
    return this.create({
      type: 'FILE',
      title: input.title?.trim() || (file.filename ?? 'Document').replace(/\.[a-z0-9]+$/i, ''),
      fileId: file.id,
      sizeBytes: Number(file.sizeBytes),
    })
  }

  addFaq(input: CreateAiFaqSourceRequest): Promise<AiKnowledgeSource> {
    const body = { pairs: input.pairs }
    return this.create({
      type: 'FAQ',
      title: input.title,
      body,
      sizeBytes: Buffer.byteLength(JSON.stringify(body)),
    })
  }

  addText(input: CreateAiTextSourceRequest): Promise<AiKnowledgeSource> {
    return this.create({
      type: 'TEXT',
      title: input.title,
      body: { text: input.text },
      sizeBytes: Buffer.byteLength(input.text),
    })
  }

  async replace(id: string, input: ReplaceAiSourceRequest): Promise<AiKnowledgeSource> {
    const file = 'fileId' in input ? await this.readyFile(input.fileId) : null
    return this.run(async (tx) => {
      const row = await this.find(tx, id, true)
      const ok =
        (row.type === 'FILE' && file) ||
        (row.type === 'FAQ' && 'pairs' in input) ||
        (row.type === 'TEXT' && 'text' in input)
      if (!ok)
        throw AppError.validation(
          [{ path: 'type', code: 'mismatch', message: 'Replace a source with the same kind of content.' }],
          'This content does not match the source type.',
        )
      const body =
        'pairs' in input ? { pairs: input.pairs } : 'text' in input ? { text: input.text } : null
      return this.requeue(tx, row, 'ai.source_replaced', {
        ...(file ? { fileId: file.id, sizeBytes: file.sizeBytes } : {}),
        ...(body
          ? {
              body: body as Prisma.InputJsonValue,
              sizeBytes: Buffer.byteLength('text' in input ? input.text : JSON.stringify(body)),
            }
          : {}),
      })
    })
  }

  reprocess(id: string): Promise<AiKnowledgeSource> {
    return this.run(async (tx) => this.requeue(tx, await this.find(tx, id, true), 'ai.source_reprocessed', {}))
  }

  /** Chunks go with the source (cascade); usage rows and reply logs stay for reporting. */
  remove(id: string): Promise<void> {
    const { tenantId } = currentTenant()
    return this.run(async (tx) => {
      const row = await this.find(tx, id, true)
      await tx.aiKnowledgeSource.delete({ where: { id: row.id } })
      if (row.fileId) await tx.file.deleteMany({ where: { id: row.fileId, tenantId } })
      await this.audit.write(tx, {
        action: 'ai.source_deleted',
        targetType: 'ai_knowledge_source',
        targetId: row.id,
        changes: { title: row.title, type: row.type },
      })
    })
  }

  // ------------------------------------------------------------------------------ playground

  async playground(question: string): Promise<AiPlaygroundResponse> {
    const { tenantId } = currentTenant()
    const settings = await this.run(async (_tx, s) => s)
    await this.limits.consume([
      { bucket: 'ai-playground', key: tenantId, limit: this.config.playgroundPerMinute, windowSeconds: 60 },
    ])
    const a = await this.answers.answer(tenantId, { question, history: [], playground: true })
    const text = playgroundText(a, settings)
    if (text !== a.reply)
      await this.tenantDb.run((tx) =>
        tx.aiReplyLog.update({ where: { id: a.logId }, data: { reply: text, decided: true } }),
      )
    return {
      outcome: a.outcome,
      answer: text,
      sources: a.sources.map((s) => ({ documentTitle: s.documentTitle, page: s.page, snippet: s.snippet })),
      tokens: a.tokens,
    }
  }

  // ------------------------------------------------------------------------------ usage

  usage(): Promise<AiUsage> {
    const { tenantId } = currentTenant()
    return this.run(async (tx, settings) => {
      const since = new Date(Date.now() - 29 * 86_400_000)
      since.setUTCHours(0, 0, 0, 0)
      const [used, replies, tokens] = await Promise.all([
        quotaUsed(tx, tenantId),
        tx.$queryRaw<Array<{ day: string; n: number }>>`
          SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
                 count(*)::integer AS n
          FROM ai_reply_logs
          WHERE tenant_id = ${tenantId}::uuid AND billable AND created_at >= ${since}
          GROUP BY 1`,
        tx.$queryRaw<Array<{ day: string; input: number; output: number }>>`
          SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
                 sum(input_tokens)::integer AS input, sum(output_tokens)::integer AS output
          FROM ai_usage
          WHERE tenant_id = ${tenantId}::uuid AND created_at >= ${since}
          GROUP BY 1`,
      ])
      const r = new Map(replies.map((x) => [x.day, x.n]))
      const t = new Map(tokens.map((x) => [x.day, x]))
      const days = Array.from({ length: 30 }, (_, i) => {
        const date = new Date(since.getTime() + i * 86_400_000).toISOString().slice(0, 10)
        return {
          date,
          replies: r.get(date) ?? 0,
          inputTokens: t.get(date)?.input ?? 0,
          outputTokens: t.get(date)?.output ?? 0,
        }
      })
      return {
        month: monthStart().toISOString().slice(0, 7),
        used,
        quota: settings.monthlyMessageQuota,
        days,
      }
    })
  }

  activity(limit = 50): Promise<AiReplyLog[]> {
    const { tenantId } = currentTenant()
    return this.run(async (tx) =>
      (
        await tx.aiReplyLog.findMany({
          where: { tenantId },
          orderBy: { createdAt: 'desc' },
          take: Math.min(Math.max(limit, 1), 200),
        })
      ).map(toReplyLog),
    )
  }

  // ------------------------------------------------------------------------------ internals

  /** Every AI route: the workspace must have AI enabled (operator switch). */
  private run<T>(
    fn: (tx: TenantTx, settings: NonNullable<Awaited<ReturnType<typeof loadSettings>>>) => Promise<T>,
  ): Promise<T> {
    const { tenantId } = currentTenant()
    return this.tenantDb.run(async (tx) => {
      const settings = await loadSettings(tx, tenantId)
      if (!settings?.enabled)
        throw new AppError('AI_NOT_ENABLED', 403, 'AI Assistant is not enabled for this workspace.')
      return fn(tx, settings)
    })
  }

  private async create(input: {
    type: 'FILE' | 'FAQ' | 'TEXT'
    title: string
    fileId?: string
    body?: unknown
    sizeBytes: number
  }): Promise<AiKnowledgeSource> {
    const { tenantId } = currentTenant()
    const { userId } = currentAuth()
    return this.run(async (tx) => {
      await this.assertRoom(tx, tenantId)
      if (input.fileId) {
        const used = await tx.aiKnowledgeSource.count({ where: { tenantId, fileId: input.fileId } })
        if (used) throw new AppError('CONFLICT', 409, 'This upload is already a knowledge source.')
      }
      const row = await tx.aiKnowledgeSource.create({
        data: {
          tenantId,
          type: input.type,
          title: input.title,
          fileId: input.fileId ?? null,
          body: (input.body ?? undefined) as Prisma.InputJsonValue | undefined,
          sizeBytes: input.sizeBytes,
          createdBy: userId,
        },
      })
      await this.enqueue(tx, tenantId, row.id, row.generation)
      await this.audit.write(tx, {
        action: 'ai.source_added',
        targetType: 'ai_knowledge_source',
        targetId: row.id,
        changes: { title: row.title, type: row.type },
      })
      const files = await this.filesOf(tx, [row])
      return toSource(row, row.fileId ? files.get(row.fileId) : null)
    })
  }

  /** New generation: the current one keeps answering until the new one commits. */
  private async requeue(
    tx: TenantTx,
    row: Prisma.AiKnowledgeSourceGetPayload<object>,
    action: string,
    data: { fileId?: string; sizeBytes?: bigint | number; body?: Prisma.InputJsonValue },
  ): Promise<AiKnowledgeSource> {
    const { tenantId } = currentTenant()
    const previousFile = data.fileId && row.fileId !== data.fileId ? row.fileId : null
    const updated = await tx.aiKnowledgeSource.update({
      where: { id: row.id },
      data: {
        ...data,
        generation: { increment: 1 },
        status: 'PROCESSING',
        failureReason: null,
      },
    })
    if (previousFile) await tx.file.deleteMany({ where: { id: previousFile, tenantId } })
    await this.enqueue(tx, tenantId, updated.id, updated.generation)
    await this.audit.write(tx, {
      action,
      targetType: 'ai_knowledge_source',
      targetId: row.id,
      changes: { title: row.title, generation: updated.generation },
    })
    const files = await this.filesOf(tx, [updated])
    return toSource(updated, updated.fileId ? files.get(updated.fileId) : null)
  }

  private enqueue(tx: TenantTx, tenantId: string, sourceId: string, generation: number) {
    return tx.outboxEvent.create({
      data: {
        tenantId,
        eventType: 'ai.knowledge_source.ingest_requested',
        aggregateType: 'ai_knowledge_source',
        aggregateId: sourceId,
        payload: { sourceId, generation },
      },
    })
  }

  private async assertRoom(tx: TenantTx, tenantId: string) {
    const count = await tx.aiKnowledgeSource.count({ where: { tenantId } })
    if (count >= this.config.maxSourcesPerWorkspace)
      throw new AppError(
        'LIMIT_EXCEEDED',
        422,
        `You can have up to ${this.config.maxSourcesPerWorkspace} knowledge sources. Delete one to add another.`,
      )
  }

  private async find(tx: TenantTx, id: string, lock = false) {
    const { tenantId } = currentTenant()
    if (lock) await tx.$queryRaw`SELECT id FROM ai_knowledge_sources WHERE id = ${id}::uuid FOR UPDATE`
    const row = await tx.aiKnowledgeSource.findFirst({ where: { id, tenantId } })
    if (!row) throw AppError.notFound('Knowledge source not found.')
    return row
  }

  private async filesOf(tx: TenantTx, rows: Array<{ fileId: string | null }>) {
    const ids = rows.map((r) => r.fileId).filter((x): x is string => Boolean(x))
    if (!ids.length) return new Map<string, { filename: string | null; mimeType: string }>()
    const files = await tx.file.findMany({
      where: { id: { in: ids } },
      select: { id: true, filename: true, mimeType: true },
    })
    return new Map(files.map((f) => [f.id, f]))
  }

  /** Checks a finished presigned upload: size, then content (PDF/ZIP magic, or UTF-8 text). */
  private async readyFile(fileId: string) {
    const file = await this.run((tx) =>
      tx.file.findFirst({ where: { id: fileId, purpose: 'AI_KNOWLEDGE' } }),
    )
    if (!file) throw AppError.notFound('Upload not found.')
    if (file.status === 'READY') return file
    if (file.status === 'REJECTED')
      throw new AppError('UNPROCESSABLE', 422, 'This file was rejected. Upload a different file.')
    let ok = await verifyUpload(this.storage, file)
    if (ok === null) throw new AppError('FILE_NOT_READY', 422, 'The upload has not finished yet.')
    if (ok && !(file.mimeType in AI_KNOWLEDGE_MIME_TYPES)) ok = false
    if (ok && file.mimeType.endsWith('wordprocessingml.document'))
      ok = (await this.storage.getBytes(file.bucket, file.objectKey, 'bytes=0-3')).equals(ZIP_MAGIC)
    if (ok && file.mimeType.startsWith('text/')) {
      const head = await this.storage.getBytes(file.bucket, file.objectKey, 'bytes=0-4095')
      ok = !head.includes(0)
    }
    const updated = await this.tenantDb.run((tx) =>
      tx.file.update({ where: { id: file.id }, data: { status: ok ? 'READY' : 'REJECTED' } }),
    )
    if (!ok)
      throw new AppError(
        'UNPROCESSABLE',
        422,
        "This file's content doesn't match its type. Upload a PDF, Word (.docx), text, Markdown or CSV file.",
      )
    return updated
  }
}

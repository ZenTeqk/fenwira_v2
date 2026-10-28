import {
  type AiConfig,
  type AiProvider,
  AiProviderError,
  type Chunk,
  chunkSections,
  ExtractionError,
  extractText,
  faqChunks,
  KNOWLEDGE_FILE_TYPES,
  type KnowledgeFileKind,
} from '@fenwira/ai'
import { Database } from '@fenwira/database'
import { type EventJob, QUEUES } from '@fenwira/queue'
import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common'
import { type Job } from 'bullmq'
import { PinoLogger } from 'nestjs-pino'
import { type QueueProcessor } from '../../core/queue/queue-processor'
import { QueueRegistry } from '../../core/queue/queue-registry'
import { RealtimeEmitter } from '../../core/realtime/realtime-emitter'
import { StorageService } from '../../core/storage/storage.service'
import { insertChunks } from './ai.core'
import { AI_CONFIG, AI_PROVIDER } from './ai.options'

export const RETENTION_JOB = 'ai-retention'
/** Texts per embedding request batch. */
const EMBED_BATCH = 32
const RETENTION_BATCH = 5000

type Data = EventJob<'ai.knowledge_source.ingest_requested'> | Record<string, never>

/** A failure the customer can act on: the source becomes FAILED with this message. */
class IngestRejected extends Error {}

/**
 * ai.ingest (docs/AI_ASSISTANT.md → Ingestion): extract → chunk → embed in batches → swap the
 * source's chunks to the new generation in one transaction (answers see the old version until
 * the commit, never half of the new one). Infrastructure errors are retried (3 attempts); the
 * last attempt, and anything the customer must fix, marks the source FAILED with a reason.
 * Also runs the daily reply-log retention purge (X23).
 */
@Injectable()
export class AiIngestProcessor implements QueueProcessor<Data>, OnApplicationBootstrap {
  readonly queue = QUEUES.aiIngest
  readonly concurrency = 2
  private retryTimer?: NodeJS.Timeout

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AI_CONFIG) private readonly config: AiConfig,
    @Inject(AI_PROVIDER) private readonly provider: AiProvider,
    private readonly storage: StorageService,
    private readonly queues: QueueRegistry,
    private readonly realtime: RealtimeEmitter,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('AiIngest')
  }

  onApplicationBootstrap(): void {
    void this.schedule(0)
  }

  onApplicationShutdown(): void {
    clearTimeout(this.retryTimer)
  }

  private async schedule(attempt: number): Promise<void> {
    try {
      await this.queues
        .get(this.queue)
        .upsertJobScheduler(
          'ai-retention',
          { every: 6 * 3600_000 },
          { name: RETENTION_JOB, data: {}, opts: { removeOnComplete: 20, removeOnFail: 20 } },
        )
    } catch {
      this.retryTimer = setTimeout(
        () => void this.schedule(attempt + 1),
        Math.min(30_000, 1000 * 2 ** attempt),
      )
    }
  }

  async process(job: Job<Data>): Promise<unknown> {
    if (job.name === RETENTION_JOB) return this.retention()
    const e = job.data as EventJob<'ai.knowledge_source.ingest_requested'>
    if (!e.tenantId || !e.payload) return 'ignored'
    const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1)
    return this.ingest(e.tenantId, e.payload.sourceId, e.payload.generation, lastAttempt)
  }

  async ingest(
    tenantId: string,
    sourceId: string,
    generation: number,
    lastAttempt = true,
  ): Promise<string> {
    const source = await this.db.withTenant(tenantId, (tx) =>
      tx.aiKnowledgeSource.findFirst({ where: { id: sourceId, tenantId } }),
    )
    if (!source || source.generation !== generation) return 'superseded'
    if (source.activeGeneration >= generation && source.status === 'READY') return 'done'
    const started = Date.now()
    try {
      const chunks = await this.chunksOf(tenantId, source)
      if (!chunks.length) throw new IngestRejected('This source has no text we can use.')
      if (chunks.length > this.config.maxChunksPerSource)
        throw new IngestRejected(
          `This document is too long (more than ${this.config.maxChunksPerSource} sections). Split it into smaller files.`,
        )
      const others = await this.db.withTenant(tenantId, (tx) =>
        tx.aiKnowledgeSource.aggregate({
          where: { tenantId, id: { not: sourceId }, activeGeneration: { gt: 0 } },
          _sum: { chunkCount: true },
        }),
      )
      if ((others._sum.chunkCount ?? 0) + chunks.length > this.config.maxChunksPerWorkspace)
        throw new IngestRejected(
          'Your knowledge base is full. Delete documents you no longer need, then try again.',
        )
      const vectors: number[][] = []
      for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
        const batch = chunks.slice(i, i + EMBED_BATCH)
        const out = await this.provider.embed(
          batch.map((c) => c.content),
          'document',
        )
        vectors.push(...out.vectors)
        await this.db.withTenant(tenantId, (tx) =>
          tx.aiUsage.create({
            data: {
              tenantId,
              sourceId,
              model: out.model,
              inputTokens: out.usage.inputTokens,
              outputTokens: 0,
              kind: 'EMBEDDING',
            },
          }),
        )
      }
      const committed = await this.db.withTenant(
        tenantId,
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM ai_knowledge_sources WHERE id = ${sourceId}::uuid FOR UPDATE`
          const fresh = await tx.aiKnowledgeSource.findFirst({ where: { id: sourceId, tenantId } })
          // Deleted, or replaced again while we were embedding: the newer job wins.
          if (!fresh || fresh.generation !== generation) return false
          await insertChunks(tx, tenantId, sourceId, generation, chunks, vectors)
          await tx.aiKnowledgeChunk.deleteMany({
            where: { tenantId, sourceId, generation: { not: generation } },
          })
          await tx.aiKnowledgeSource.update({
            where: { id: sourceId },
            data: {
              activeGeneration: generation,
              status: 'READY',
              failureReason: null,
              chunkCount: chunks.length,
            },
          })
          return true
        },
        { timeoutMs: 60_000 },
      )
      if (!committed) return 'superseded'
      this.logger.info(
        { tenantId, sourceId, generation, chunks: chunks.length, ms: Date.now() - started },
        'ai source indexed',
      )
      this.changed(tenantId, sourceId, 'READY')
      return 'ready'
    } catch (err) {
      const retryable =
        !(err instanceof IngestRejected) &&
        !(err instanceof ExtractionError) &&
        !(err instanceof AiProviderError && !err.retryable)
      if (retryable && !lastAttempt) throw err
      const reason =
        err instanceof IngestRejected || err instanceof ExtractionError
          ? err.message
          : "We couldn't process this source right now. Try Reprocess in a few minutes."
      this.logger.warn(
        {
          tenantId,
          sourceId,
          generation,
          error: err instanceof Error ? err.name : 'Error',
          code: (err as { code?: string }).code,
        },
        'ai source failed',
      )
      const marked = await this.db.withTenant(tenantId, (tx) =>
        tx.aiKnowledgeSource.updateMany({
          where: { id: sourceId, tenantId, generation },
          data: { status: 'FAILED', failureReason: reason },
        }),
      )
      if (marked.count) this.changed(tenantId, sourceId, 'FAILED')
      return 'failed'
    }
  }

  private async chunksOf(
    tenantId: string,
    source: { type: string; fileId: string | null; body: unknown },
  ): Promise<Chunk[]> {
    const body = (source.body ?? {}) as {
      pairs?: Array<{ question: string; answer: string }>
      text?: string
    }
    if (source.type === 'FAQ') return faqChunks(body.pairs ?? [])
    if (source.type === 'TEXT') return chunkSections([{ text: body.text ?? '' }])
    const file = source.fileId
      ? await this.db.withTenant(tenantId, (tx) =>
          tx.file.findFirst({ where: { id: source.fileId!, tenantId, status: 'READY' } }),
        )
      : null
    if (!file) throw new IngestRejected('The uploaded file is missing. Upload it again.')
    const kind = (KNOWLEDGE_FILE_TYPES as Record<string, KnowledgeFileKind>)[file.mimeType]
    if (!kind) throw new IngestRejected('This file type is not supported.')
    const bytes = await this.storage.getBytes(file.bucket, file.objectKey)
    const sections = await extractText(bytes, kind)
    return chunkSections(sections)
  }

  /** X23: reply-log rows older than the retention period, in batches. */
  async retention(now = new Date()): Promise<number> {
    const before = new Date(now.getTime() - this.config.replyLogRetentionDays * 86_400_000)
    let total = 0
    for (let i = 0; i < 100; i++) {
      const n = await this.db.system.purgeAiReplyLogs(before, RETENTION_BATCH)
      total += n
      if (n < RETENTION_BATCH) break
    }
    if (total) this.logger.info({ purged: total }, 'ai reply logs purged')
    return total
  }

  private changed(tenantId: string, sourceId: string, status: 'READY' | 'FAILED') {
    this.realtime.toTenant(tenantId, 'ai.source.updated', { sourceId, status })
  }
}

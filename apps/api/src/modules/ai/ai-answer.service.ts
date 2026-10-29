import {
  type AiConfig,
  type AiProvider,
  AiProviderError,
  answerQuestion,
  type AnswerSource,
  type HistoryTurn,
} from '@fenwira/ai'
import { uuidv7 } from '@fenwira/config'
import { type AiOutcome } from '@fenwira/contracts'
import { Database, type Prisma } from '@fenwira/database'
import { Inject, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import {
  DEFAULT_FALLBACK,
  excerptOf,
  loadSettings,
  quotaUsed,
  searchChunks,
  type SettingsRow,
} from './ai.core'
import { AI_CONFIG, AI_PROVIDER } from './ai.options'

export type AnswerRequest = {
  question: string
  history: HistoryTurn[]
  extraInstructions?: string | null
  conversationId?: string | null
  /** Automation execution + step: the saved answer for this pair is reused, never recomputed. */
  runId?: string
  stepId?: string
  playground?: boolean
}

export type SavedAnswer = {
  logId: string
  outcome: AiOutcome
  reason: string
  /** Model answer (REPLIED) or, once decided, the exact text sent to the customer. */
  reply: string | null
  decided: boolean
  sources: AnswerSource[]
  billable: boolean
  tokens: { input: number; output: number }
  /** True when an earlier attempt of the same step produced this row. */
  reused: boolean
}

export type StepDecision = {
  outcome: AiOutcome
  /** What to send the customer now (null = nothing). */
  text: string | null
  handoff: boolean
}

type LogRow = Prisma.AiReplyLogGetPayload<object>

const fromRow = (r: LogRow, reused: boolean): SavedAnswer => {
  const meta = (r.sources as unknown as { reason?: string; items?: AnswerSource[] }) ?? {}
  return {
    logId: r.id,
    outcome: r.outcome,
    reason: meta.reason ?? r.outcome,
    reply: r.reply,
    decided: r.decided,
    sources: meta.items ?? [],
    billable: r.billable,
    tokens: { input: r.inputTokens, output: r.outputTokens },
    reused,
  }
}

/**
 * Runs the answer pipeline for a workspace with Postgres-backed retrieval, quota and usage, and
 * saves every attempt in ai_reply_logs (docs/AI_ASSISTANT.md → Answering). Model calls never
 * happen inside a database transaction. Provider failures become an ERROR row (the step takes
 * its error path) — the SDK already retried throttling — so a retry never loops on Bedrock.
 */
@Injectable()
export class AiAnswerService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AI_CONFIG) private readonly config: AiConfig,
    @Inject(AI_PROVIDER) private readonly provider: AiProvider,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('AiAnswer')
  }

  async answer(tenantId: string, req: AnswerRequest): Promise<SavedAnswer> {
    if (req.runId && req.stepId) {
      const saved = await this.saved(tenantId, req.runId, req.stepId)
      if (saved) return saved
    }
    const settings = await this.db.withTenant(tenantId, (tx) => loadSettings(tx, tenantId))
    const countsQuota = !req.playground || this.config.playgroundCountsQuota
    const base = {
      tenantId,
      conversationId: req.conversationId ?? null,
      runId: req.runId ?? null,
      stepId: req.stepId ?? null,
    }
    let outcome: AiOutcome
    let reason: string
    let reply: string | null = null
    let sources: AnswerSource[] = []
    let billable = false
    let tokens = { input: 0, output: 0 }
    if (!settings?.enabled) {
      outcome = 'ERROR'
      reason = 'AI_NOT_ENABLED'
    } else {
      try {
        const r = await answerQuestion(
          {
            provider: this.provider,
            config: this.config,
            logger: this.logger,
            store: {
              search: (vector, limit) =>
                this.db.withTenant(tenantId, (tx) =>
                  searchChunks(tx, tenantId, vector, limit, this.config.embeddingDimension),
                ),
            },
            quotaAvailable: async () =>
              !countsQuota ||
              (await this.db.withTenant(tenantId, (tx) => quotaUsed(tx, tenantId))) <
                settings.monthlyMessageQuota,
            recordUsage: (u) =>
              this.db.withTenant(tenantId, async (tx) => {
                await tx.aiUsage.create({
                  data: {
                    ...base,
                    model: u.model,
                    inputTokens: u.inputTokens,
                    outputTokens: u.outputTokens,
                    kind: u.kind,
                  },
                })
              }),
          },
          {
            question: req.question,
            history: req.history,
            extraInstructions: req.extraInstructions,
            settings: {
              businessName: settings.businessName,
              businessDescription: settings.businessDescription,
              tone: settings.tone,
            },
          },
        )
        outcome = r.outcome
        reason = r.reason
        reply = r.answer
        sources = r.sources
        billable = r.billable && countsQuota
        tokens = {
          input: (r.usage.reply?.inputTokens ?? 0) + (r.usage.embedding?.inputTokens ?? 0),
          output: r.usage.reply?.outputTokens ?? 0,
        }
      } catch (err) {
        if (!(err instanceof AiProviderError)) throw err
        outcome = 'ERROR'
        reason = err.code
      }
    }
    const data = {
      id: uuidv7(),
      ...base,
      customerMessageExcerpt: excerptOf(req.question.trim()),
      retrievedChunkIds: sources.map((s) => s.chunkId),
      // Display data (title/page/snippet) is kept with the row: sources may change later.
      sources: { reason, items: sources } as unknown as Prisma.InputJsonValue,
      reply,
      outcome,
      billable,
      playground: req.playground ?? false,
      inputTokens: tokens.input,
      outputTokens: tokens.output,
    }
    // Two workers on the same step: the first row wins and both return it.
    await this.db.withTenant(tenantId, (tx) =>
      tx.aiReplyLog.createMany({ data, skipDuplicates: true }),
    )
    this.logger.info(
      { tenantId, outcome, reason, billable, sources: sources.length, ...tokens },
      'ai answer',
    )
    if (req.runId && req.stepId) return (await this.saved(tenantId, req.runId, req.stepId))!
    const row = await this.db.withTenant(tenantId, (tx) =>
      tx.aiReplyLog.findFirstOrThrow({ where: { id: data.id } }),
    )
    return fromRow(row, false)
  }

  /**
   * The step's final decision, saved on the log row before anything is sent (a retry reads it
   * back): reply, keep going with the fallback, or hand off (wants a human, quota, nothing found
   * in single mode, or a second no-answer in a row in conversation mode).
   */
  async decide(
    tenantId: string,
    a: SavedAnswer,
    ctx: { conversationId: string; mode: 'SINGLE' | 'CONVERSATION' },
  ): Promise<StepDecision> {
    if (a.decided) return { outcome: a.outcome, text: a.reply, handoff: isHandoff(a.outcome) }
    return this.db.withTenant(tenantId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM ai_reply_logs WHERE id = ${a.logId}::uuid FOR UPDATE`
      const row = await tx.aiReplyLog.findFirstOrThrow({ where: { id: a.logId } })
      if (row.decided)
        return { outcome: row.outcome, text: row.reply, handoff: isHandoff(row.outcome) }
      const settings = await loadSettings(tx, tenantId)
      let decision: StepDecision
      if (row.outcome === 'REPLIED')
        decision = { outcome: 'REPLIED', text: row.reply, handoff: false }
      else if (row.outcome === 'ERROR') decision = { outcome: 'ERROR', text: null, handoff: false }
      else if (row.outcome === 'NO_ANSWER') {
        const previous = await tx.aiReplyLog.findFirst({
          where: {
            tenantId,
            conversationId: ctx.conversationId,
            playground: false,
            id: { not: row.id },
            createdAt: { lte: row.createdAt },
          },
          orderBy: { createdAt: 'desc' },
          select: { outcome: true },
        })
        const handoff = ctx.mode === 'SINGLE' || previous?.outcome === 'NO_ANSWER'
        decision = handoff
          ? { outcome: 'HANDOFF', text: handoffText(settings, true), handoff: true }
          : {
              outcome: 'NO_ANSWER',
              text: settings?.fallbackMessage || DEFAULT_FALLBACK,
              handoff: false,
            }
      } else
        decision = {
          outcome: row.outcome,
          text: handoffText(settings, false),
          handoff: true,
        }
      await tx.aiReplyLog.update({
        where: { id: row.id },
        data: { outcome: decision.outcome, reply: decision.text, decided: true },
      })
      return decision
    })
  }

  private async saved(tenantId: string, runId: string, stepId: string) {
    const row = await this.db.withTenant(tenantId, (tx) =>
      tx.aiReplyLog.findFirst({ where: { tenantId, runId, stepId } }),
    )
    return row ? fromRow(row, true) : null
  }
}

const isHandoff = (o: AiOutcome) => o === 'HANDOFF' || o === 'QUOTA'

/** The workspace's handoff message; after a no-answer, the fallback stands in when it's unset. */
function handoffText(settings: SettingsRow | null, afterNoAnswer: boolean): string | null {
  if (settings?.handoffMessage) return settings.handoffMessage
  return afterNoAnswer ? settings?.fallbackMessage || null : null
}

/** What the playground shows as "the customer would receive" (no conversation state). */
export function playgroundText(a: SavedAnswer, settings: SettingsRow | null): string | null {
  if (a.outcome === 'REPLIED') return a.reply
  if (a.outcome === 'NO_ANSWER') return settings?.fallbackMessage || DEFAULT_FALLBACK
  if (a.outcome === 'HANDOFF' || a.outcome === 'QUOTA') return settings?.handoffMessage ?? null
  return null
}

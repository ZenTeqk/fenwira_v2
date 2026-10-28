import { type AiConfig } from './config'
import {
  buildReplyPrompt,
  type AiTone,
  type Excerpt,
  type HistoryTurn,
  parseModelOutput,
  toWhatsAppText,
} from './prompt'
import { type AiLogger, type AiProvider, type Usage } from './provider'

export type RetrievedChunk = {
  id: string
  sourceId: string
  title: string
  page: number | null
  content: string
  similarity: number
}

/** Workspace-bound retrieval. Implementations filter by tenant in the query (and RLS). */
export interface KnowledgeStore {
  search(vector: number[], limit: number): Promise<RetrievedChunk[]>
}

export type AnswerSource = {
  chunkId: string
  sourceId: string
  documentTitle: string
  page: number | null
  snippet: string
  similarity: number
}

export type AnswerOutcome = 'REPLIED' | 'NO_ANSWER' | 'HANDOFF' | 'QUOTA'
export type AnswerReason =
  | 'ANSWERED'
  | 'NO_MATCH'
  | 'CANNOT_ANSWER'
  | 'UNREADABLE_OUTPUT'
  | 'WANTS_HUMAN'
  | 'QUOTA_EXHAUSTED'

export type AnswerResult = {
  outcome: AnswerOutcome
  reason: AnswerReason
  /** WhatsApp-ready text when outcome is REPLIED; null otherwise. */
  answer: string | null
  sources: AnswerSource[]
  /** The reply model was called (counts against the monthly quota). */
  billable: boolean
  usage: { reply: Usage | null; embedding: Usage | null }
}

export type AnswerInput = {
  question: string
  history: HistoryTurn[]
  settings: { businessName: string | null; businessDescription: string | null; tone: AiTone }
  extraInstructions?: string | null
}

export type AnswerDeps = {
  provider: AiProvider
  config: AiConfig
  store: KnowledgeStore
  logger: AiLogger
  /** Checked before any model call; false → QUOTA without calling anything. */
  quotaAvailable: () => Promise<boolean>
  /** Called once per model call, as soon as it returns. */
  recordUsage: (u: { kind: 'REPLY' | 'EMBEDDING'; model: string } & Usage) => Promise<void>
}

/** Bounds a history to the last N turns and each turn to 500 characters. */
export function truncateHistory(history: HistoryTurn[], max: number): HistoryTurn[] {
  return history
    .filter((t) => t.text.trim())
    .slice(-max)
    .map((t) => ({ ...t, text: t.text.length > 500 ? `${t.text.slice(0, 500)}…` : t.text }))
}

/** Keeps excerpts in rank order until the character budget is spent (the last one is cut). */
export function fitExcerpts(chunks: RetrievedChunk[], budget: number): Excerpt[] {
  const out: Excerpt[] = []
  let left = budget
  for (const c of chunks) {
    if (left < 200) break
    const content = c.content.length > left ? `${c.content.slice(0, left)}…` : c.content
    out.push({ id: c.id, title: c.title, page: c.page, content })
    left -= content.length
  }
  return out
}

/** An explicit request for a person hands off at once (no retrieval, no model call). */
const HUMAN_REQUEST =
  /\b(human|real person|live agent|an agent|customer (care|service)|representative|talk to (someone|somebody|a person|staff|the owner)|speak (to|with) (someone|somebody|a person|staff|the owner)|call me( back)?)\b/i
export const asksForHuman = (text: string) => HUMAN_REQUEST.test(text)

const snippet = (text: string) =>
  text.length > 240 ? `${text.slice(0, 240).replace(/\s+\S*$/, '')}…` : text

/**
 * The answer pipeline (docs/AI_ASSISTANT.md → Answering): quota → embed the question → retrieve
 * the workspace's top K above the similarity threshold → (nothing passes: NO_ANSWER without a
 * model call) → prompt with delimited data → structured output → outcome. Provider failures
 * propagate as AiProviderError for the caller to retry or record as an error.
 */
export async function answerQuestion(deps: AnswerDeps, input: AnswerInput): Promise<AnswerResult> {
  const { config } = deps
  const empty = { reply: null, embedding: null }
  if (!(await deps.quotaAvailable()))
    return { outcome: 'QUOTA', reason: 'QUOTA_EXHAUSTED', answer: null, sources: [], billable: false, usage: empty }

  const question = input.question.trim().slice(0, 2000)
  if (!question)
    return { outcome: 'NO_ANSWER', reason: 'NO_MATCH', answer: null, sources: [], billable: false, usage: empty }
  if (asksForHuman(question))
    return { outcome: 'HANDOFF', reason: 'WANTS_HUMAN', answer: null, sources: [], billable: false, usage: empty }
  const embedded = await deps.provider.embed([question], 'query')
  await deps.recordUsage({ kind: 'EMBEDDING', model: embedded.model, ...embedded.usage })
  const usage: AnswerResult['usage'] = { reply: null, embedding: embedded.usage }

  const hits = (await deps.store.search(embedded.vectors[0]!, config.topK)).filter(
    (c) => c.similarity >= config.minSimilarity,
  )
  const sources: AnswerSource[] = hits.map((c) => ({
    chunkId: c.id,
    sourceId: c.sourceId,
    documentTitle: c.title,
    page: c.page,
    snippet: snippet(c.content),
    similarity: Math.round(c.similarity * 1000) / 1000,
  }))
  if (!hits.length)
    return { outcome: 'NO_ANSWER', reason: 'NO_MATCH', answer: null, sources, billable: false, usage }

  const request = buildReplyPrompt({
    ...input.settings,
    extraInstructions: input.extraInstructions,
    excerpts: fitExcerpts(hits, config.retrievalCharBudget),
    history: truncateHistory(input.history, config.historyMessages),
    question,
    maxTokens: config.maxOutputTokens,
  })
  const reply = await deps.provider.converse(request)
  await deps.recordUsage({ kind: 'REPLY', model: reply.model, ...reply.usage })
  usage.reply = reply.usage

  const parsed = parseModelOutput(reply.text)
  const base = { sources, billable: true, usage }
  if (!parsed) {
    deps.logger.warn({ ai: 'answer', reason: 'UNREADABLE_OUTPUT' }, 'ai reply not usable')
    return { ...base, outcome: 'NO_ANSWER', reason: 'UNREADABLE_OUTPUT', answer: null }
  }
  if (parsed.wants_human) return { ...base, outcome: 'HANDOFF', reason: 'WANTS_HUMAN', answer: null }
  if (!parsed.can_answer)
    return { ...base, outcome: 'NO_ANSWER', reason: 'CANNOT_ANSWER', answer: null }
  const answer = toWhatsAppText(parsed.answer)
  if (!answer) return { ...base, outcome: 'NO_ANSWER', reason: 'CANNOT_ANSWER', answer: null }
  return { ...base, outcome: 'REPLIED', reason: 'ANSWERED', answer }
}

/**
 * The model boundary. Everything above it (ingestion, retrieval, the answer pipeline) is provider
 * independent; `BedrockProvider` is the production implementation and `MockProvider` the test one.
 */

export type Usage = { inputTokens: number; outputTokens: number }

export type ConverseRequest = {
  system: string
  messages: Array<{ role: 'user' | 'assistant'; text: string }>
  maxTokens: number
  temperature?: number
}

export type ConverseResult = { text: string; usage: Usage; model: string }

export type EmbedResult = { vectors: number[][]; usage: Usage; model: string }

export interface AiProvider {
  converse(req: ConverseRequest): Promise<ConverseResult>
  /** One vector per input, in order. `purpose` lets providers that distinguish them do so. */
  embed(texts: string[], purpose: 'document' | 'query'): Promise<EmbedResult>
}

/**
 * A provider failure. `retryable` = infrastructure (throttling, timeouts, 5xx): the job is
 * retried. Otherwise (access denied, invalid model id) retrying cannot help.
 */
export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly code: string,
  ) {
    super(message)
    this.name = 'AiProviderError'
  }
}

/** Minimal pino-compatible logger: callers pass their pino/nestjs-pino instance. */
export type AiLogger = {
  info(obj: Record<string, unknown>, msg: string): void
  warn(obj: Record<string, unknown>, msg: string): void
  debug(obj: Record<string, unknown>, msg: string): void
}

export const silentLogger: AiLogger = { info() {}, warn() {}, debug() {} }

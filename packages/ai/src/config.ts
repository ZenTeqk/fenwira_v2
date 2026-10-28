/**
 * AI Assistant runtime configuration (docs/AI_ASSISTANT.md → Configuration). Built from env by
 * `aiConfigFromEnv`; nothing here is per workspace.
 */
export type AiConfig = {
  provider: 'bedrock' | 'mock'
  region: string
  textModelId: string
  embeddingModelId: string
  embeddingDimension: number
  maxOutputTokens: number
  topK: number
  minSimilarity: number
  retrievalCharBudget: number
  historyMessages: number
  maxUploadBytes: number
  maxSourcesPerWorkspace: number
  maxChunksPerSource: number
  maxChunksPerWorkspace: number
  replyLogRetentionDays: number
  playgroundCountsQuota: boolean
  playgroundPerMinute: number
}

type AiEnv = {
  AI_PROVIDER: 'bedrock' | 'mock'
  AI_BEDROCK_REGION: string
  AI_TEXT_MODEL_ID: string
  AI_EMBEDDING_MODEL_ID: string
  AI_EMBEDDING_DIMENSION: number
  AI_MAX_OUTPUT_TOKENS: number
  AI_RETRIEVAL_TOP_K: number
  AI_MIN_SIMILARITY: number
  AI_RETRIEVAL_CHAR_BUDGET: number
  AI_HISTORY_MESSAGES: number
  AI_MAX_UPLOAD_BYTES: number
  AI_MAX_SOURCES_PER_WORKSPACE: number
  AI_MAX_CHUNKS_PER_SOURCE: number
  AI_MAX_CHUNKS_PER_WORKSPACE: number
  AI_REPLY_LOG_RETENTION_DAYS: number
  AI_PLAYGROUND_COUNTS_QUOTA: boolean
  AI_PLAYGROUND_PER_MINUTE: number
}

export function aiConfigFromEnv(env: AiEnv): AiConfig {
  return {
    provider: env.AI_PROVIDER,
    region: env.AI_BEDROCK_REGION,
    textModelId: env.AI_TEXT_MODEL_ID,
    embeddingModelId: env.AI_EMBEDDING_MODEL_ID,
    embeddingDimension: env.AI_EMBEDDING_DIMENSION,
    maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS,
    topK: env.AI_RETRIEVAL_TOP_K,
    minSimilarity: env.AI_MIN_SIMILARITY,
    retrievalCharBudget: env.AI_RETRIEVAL_CHAR_BUDGET,
    historyMessages: env.AI_HISTORY_MESSAGES,
    maxUploadBytes: env.AI_MAX_UPLOAD_BYTES,
    maxSourcesPerWorkspace: env.AI_MAX_SOURCES_PER_WORKSPACE,
    maxChunksPerSource: env.AI_MAX_CHUNKS_PER_SOURCE,
    maxChunksPerWorkspace: env.AI_MAX_CHUNKS_PER_WORKSPACE,
    replyLogRetentionDays: env.AI_REPLY_LOG_RETENTION_DAYS,
    playgroundCountsQuota: env.AI_PLAYGROUND_COUNTS_QUOTA,
    playgroundPerMinute: env.AI_PLAYGROUND_PER_MINUTE,
  }
}

/** Defaults for unit tests and the mock provider. */
export const TEST_AI_CONFIG: AiConfig = {
  provider: 'mock',
  region: 'ap-south-1',
  textModelId: 'mock-text',
  embeddingModelId: 'mock-embed',
  embeddingDimension: 256,
  maxOutputTokens: 400,
  topK: 5,
  minSimilarity: 0.3,
  retrievalCharBudget: 6000,
  historyMessages: 6,
  maxUploadBytes: 10 * 1024 * 1024,
  maxSourcesPerWorkspace: 50,
  maxChunksPerSource: 500,
  maxChunksPerWorkspace: 5000,
  replyLogRetentionDays: 30,
  playgroundCountsQuota: true,
  playgroundPerMinute: 10,
}

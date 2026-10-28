export { aiConfigFromEnv, type AiConfig, TEST_AI_CONFIG } from './config'
export {
  type AiLogger,
  type AiProvider,
  AiProviderError,
  type ConverseRequest,
  type ConverseResult,
  type EmbedResult,
  silentLogger,
  type Usage,
} from './provider'
export { BedrockProvider } from './bedrock'
export { contentWords, MockProvider } from './mock'
export {
  csvToText,
  ExtractionError,
  extractText,
  KNOWLEDGE_FILE_TYPES,
  type KnowledgeFileKind,
  SCANNED_PDF_MESSAGE,
  type TextSection,
} from './extract'
export { type Chunk, chunkSections, estimateTokens, faqChunks } from './chunk'
export {
  type AiTone,
  buildReplyPrompt,
  type Excerpt,
  type HistoryTurn,
  type ModelOutput,
  neutralize,
  parseModelOutput,
  toWhatsAppText,
} from './prompt'
export {
  answerQuestion,
  asksForHuman,
  type AnswerDeps,
  type AnswerInput,
  type AnswerOutcome,
  type AnswerReason,
  type AnswerResult,
  type AnswerSource,
  fitExcerpts,
  type KnowledgeStore,
  type RetrievedChunk,
  truncateHistory,
} from './answer'

import { BedrockProvider } from './bedrock'
import { type AiConfig } from './config'
import { MockProvider } from './mock'
import { type AiLogger, type AiProvider } from './provider'

export function createAiProvider(config: AiConfig, logger: AiLogger): AiProvider {
  return config.provider === 'bedrock'
    ? new BedrockProvider(config, logger)
    : new MockProvider(config.embeddingDimension)
}
export { makeTestPdf } from './testing'

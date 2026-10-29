import {
  BedrockRuntimeClient,
  ConverseCommand,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime'
import { type AiConfig } from './config'
import {
  type AiLogger,
  type AiProvider,
  AiProviderError,
  type ConverseRequest,
  type ConverseResult,
  type EmbedResult,
} from './provider'

/** Embedding calls in flight per batch (Titan v2 embeds one text per request). */
const EMBED_CONCURRENCY = 4

const RETRYABLE = new Set([
  'ThrottlingException',
  'ServiceUnavailableException',
  'InternalServerException',
  'ModelNotReadyException',
  'ModelTimeoutException',
  'TimeoutError',
  'RequestTimeout',
])

/**
 * Amazon Bedrock Runtime: the Converse API for replies and Titan Text Embeddings v2 (or a Cohere
 * embed model) for vectors. Credentials come from the SDK default chain — never from config.
 * Logs carry model ids, token counts and timings only; never prompt or customer text.
 */
export class BedrockProvider implements AiProvider {
  private readonly client: BedrockRuntimeClient

  constructor(
    private readonly config: AiConfig,
    private readonly logger: AiLogger,
    client?: BedrockRuntimeClient,
  ) {
    this.client =
      client ??
      new BedrockRuntimeClient({ region: config.region, maxAttempts: 4, retryMode: 'adaptive' })
  }

  async converse(req: ConverseRequest): Promise<ConverseResult> {
    const started = Date.now()
    const model = this.config.textModelId
    try {
      const res = await this.client.send(
        new ConverseCommand({
          modelId: model,
          system: [{ text: req.system }],
          messages: req.messages.map((m) => ({ role: m.role, content: [{ text: m.text }] })),
          inferenceConfig: { maxTokens: req.maxTokens, temperature: req.temperature ?? 0.2 },
        }),
      )
      const text = (res.output?.message?.content ?? [])
        .map((c) => ('text' in c && typeof c.text === 'string' ? c.text : ''))
        .join('')
      const usage = {
        inputTokens: res.usage?.inputTokens ?? 0,
        outputTokens: res.usage?.outputTokens ?? 0,
      }
      this.logger.info(
        { ai: 'converse', model, ...usage, stopReason: res.stopReason, ms: Date.now() - started },
        'ai model call',
      )
      return { text, usage, model }
    } catch (err) {
      throw this.wrap(err, model)
    }
  }

  async embed(texts: string[], purpose: 'document' | 'query'): Promise<EmbedResult> {
    const model = this.config.embeddingModelId
    const started = Date.now()
    const vectors: number[][] = new Array(texts.length)
    let inputTokens = 0
    try {
      if (model.startsWith('cohere.')) {
        // Cohere embeds up to 96 texts per request.
        for (let i = 0; i < texts.length; i += 96) {
          const slice = texts.slice(i, i + 96)
          const out = await this.invoke(model, {
            texts: slice,
            input_type: purpose === 'query' ? 'search_query' : 'search_document',
            truncate: 'END',
          })
          const embeddings = (out as { embeddings: number[][] }).embeddings
          embeddings.forEach((v, j) => (vectors[i + j] = v))
          inputTokens += slice.reduce((n, t) => n + Math.ceil(t.length / 4), 0)
        }
      } else {
        let next = 0
        const worker = async () => {
          while (next < texts.length) {
            const i = next++
            const out = (await this.invoke(model, {
              inputText: texts[i],
              dimensions: this.config.embeddingDimension,
              normalize: true,
            })) as { embedding: number[]; inputTextTokenCount?: number }
            vectors[i] = out.embedding
            inputTokens += out.inputTextTokenCount ?? 0
          }
        }
        await Promise.all(Array.from({ length: Math.min(EMBED_CONCURRENCY, texts.length) }, worker))
      }
    } catch (err) {
      throw this.wrap(err, model)
    }
    for (const v of vectors)
      if (v?.length !== this.config.embeddingDimension)
        throw new AiProviderError(
          `Embedding dimension ${v?.length} does not match AI_EMBEDDING_DIMENSION=${this.config.embeddingDimension}.`,
          false,
          'EMBEDDING_DIMENSION_MISMATCH',
        )
    const usage = { inputTokens, outputTokens: 0 }
    this.logger.info(
      { ai: 'embed', model, purpose, count: texts.length, ...usage, ms: Date.now() - started },
      'ai model call',
    )
    return { vectors, usage, model }
  }

  private async invoke(modelId: string, body: unknown): Promise<unknown> {
    const res = await this.client.send(
      new InvokeModelCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(body),
      }),
    )
    return JSON.parse(new TextDecoder().decode(res.body))
  }

  private wrap(err: unknown, model: string): AiProviderError {
    if (err instanceof AiProviderError) return err
    const name = (err as { name?: string })?.name ?? 'Error'
    const retryable = RETRYABLE.has(name) || (err as { $retryable?: unknown })?.$retryable != null
    // The SDK message never contains request content; it is safe to log.
    this.logger.warn({ ai: 'error', model, error: name, retryable }, 'ai model call failed')
    return new AiProviderError(
      (err as Error)?.message ?? 'Bedrock call failed',
      retryable || name === 'Error',
      name,
    )
  }
}

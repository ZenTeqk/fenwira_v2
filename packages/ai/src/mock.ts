import {
  type AiProvider,
  AiProviderError,
  type ConverseRequest,
  type ConverseResult,
  type EmbedResult,
} from './provider'

const STOPWORDS = new Set(
  'the and for are but not you your yours our ours with what when where which who how does did can could would should have has had this that these those from into about there their them they was were will shall may might its it is be been being any all some much many very just also than then too of on in at to by or as an a do i me my we us if so no yes'.split(
    ' ',
  ),
)

export function contentWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (w) => w.length >= 3 && !STOPWORDS.has(w),
  )
}

function hash(word: string): number {
  let h = 2166136261
  for (let i = 0; i < word.length; i++) h = Math.imul(h ^ word.charCodeAt(i), 16777619)
  return h >>> 0
}

/**
 * Deterministic stand-in for tests and machines without AWS access. Embeddings are hashed
 * bags of words (so texts sharing words are similar); replies answer from the excerpt that
 * shares the most words with the question. Tests can queue exact replies with `script` and
 * inspect every request in `calls`.
 */
export class MockProvider implements AiProvider {
  readonly calls: { converse: ConverseRequest[]; embed: string[][] } = { converse: [], embed: [] }
  /** Raw model outputs returned (FIFO) before the heuristic answer. */
  readonly script: string[] = []
  /** Set to make the next calls fail: `retryable` decides how callers treat it. */
  failNext: { retryable: boolean; times: number } | null = null

  constructor(private readonly dimension = 256) {}

  vector(text: string): number[] {
    const v = new Array<number>(this.dimension).fill(0)
    for (const w of contentWords(text)) v[hash(w) % this.dimension]! += 1
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1
    return v.map((x) => x / norm)
  }

  async embed(texts: string[]): Promise<EmbedResult> {
    this.maybeFail()
    this.calls.embed.push(texts)
    return {
      vectors: texts.map((t) => this.vector(t)),
      usage: {
        inputTokens: texts.reduce((n, t) => n + Math.ceil(t.length / 4), 0),
        outputTokens: 0,
      },
      model: 'mock-embed',
    }
  }

  async converse(req: ConverseRequest): Promise<ConverseResult> {
    this.maybeFail()
    this.calls.converse.push(req)
    const prompt = req.messages.map((m) => m.text).join('\n')
    const text = this.script.shift() ?? this.heuristic(prompt)
    return {
      text,
      usage: {
        inputTokens: Math.ceil((req.system.length + prompt.length) / 4),
        outputTokens: Math.ceil(text.length / 4),
      },
      model: 'mock-text',
    }
  }

  private heuristic(prompt: string): string {
    const question =
      /<customer_message>\n?([\s\S]*?)\n?<\/customer_message>/.exec(prompt)?.[1]?.trim() ?? ''
    if (/\b(human|agent|person|representative)\b/i.test(question))
      return JSON.stringify({ answer: '', can_answer: false, wants_human: true })
    const asked = new Set(contentWords(question))
    const excerpts = [...prompt.matchAll(/<excerpt[^>]*>\n?([\s\S]*?)\n?<\/excerpt>/g)].map(
      (m) => m[1] ?? '',
    )
    let best: { text: string; score: number } = { text: '', score: 0 }
    for (const e of excerpts) {
      const score = new Set(contentWords(e).filter((w) => asked.has(w))).size
      if (score > best.score) best = { text: e, score }
    }
    if (best.score < 2) return JSON.stringify({ answer: '', can_answer: false, wants_human: false })
    const sentence =
      best.text
        .split(/(?<=[.!?])\s+/)
        .find((s) => contentWords(s).some((w) => asked.has(w)))
        ?.trim() ?? best.text.trim()
    return JSON.stringify({ answer: sentence.slice(0, 600), can_answer: true, wants_human: false })
  }

  private maybeFail() {
    if (!this.failNext || this.failNext.times <= 0) return
    this.failNext.times -= 1
    const { retryable } = this.failNext
    if (this.failNext.times <= 0) this.failNext = null
    throw new AiProviderError('Mock provider failure', retryable, 'MockFailure')
  }
}

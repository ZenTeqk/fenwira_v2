import { type TextSection } from './extract'

export type Chunk = { ordinal: number; content: string; page: number | null }

export type ChunkOptions = {
  /** Target size in tokens (≈ 4 characters each). */
  targetTokens?: number
  overlapTokens?: number
  maxChunks?: number
}

const CHARS_PER_TOKEN = 4

/** Rough token estimate used for chunk sizing and budgets (no tokenizer dependency). */
export const estimateTokens = (text: string) => Math.ceil(text.length / CHARS_PER_TOKEN)

const isHeading = (block: string) =>
  /^#{1,6}\s/.test(block) ||
  (block.length <= 80 &&
    !/[.!?:,;]$/.test(block) &&
    !block.includes('\n') &&
    /[A-Za-z]/.test(block) &&
    (block === block.toUpperCase() || /^\d+(\.\d+)*\s+\S/.test(block)))

/**
 * Splits sections into ~450-token chunks along headings and paragraphs, with ~50 tokens of
 * overlap between consecutive chunks of the same section. A heading starts a new chunk and is
 * repeated at the top of it, so a chunk retrieved alone keeps its context. Page numbers carry
 * through (a chunk takes the page it starts on).
 */
export function chunkSections(sections: TextSection[], opts: ChunkOptions = {}): Chunk[] {
  const target = (opts.targetTokens ?? 450) * CHARS_PER_TOKEN
  const overlap = (opts.overlapTokens ?? 50) * CHARS_PER_TOKEN
  const maxChunks = opts.maxChunks ?? Number.POSITIVE_INFINITY
  const chunks: Chunk[] = []
  let current = ''
  let page: number | null = null
  let heading = ''

  const flush = (carry: boolean) => {
    const content = current.trim()
    if (content && chunks.length < maxChunks) chunks.push({ ordinal: chunks.length, content, page })
    const tail = carry ? tailOf(content, overlap) : ''
    current = tail ? (heading && !tail.startsWith(heading) ? `${heading}\n${tail}` : tail) : ''
  }

  for (const section of sections) {
    // A new PDF page starts a new chunk, so a cited page is always the page the text is on.
    if (
      section.page != null &&
      page != null &&
      section.page !== page &&
      current.trim() &&
      current.trim() !== heading
    )
      flush(false)
    for (const raw of section.text.split(/\n\s*\n/)) {
      const block = raw.trim()
      if (!block) continue
      if (isHeading(block)) {
        if (current.trim() && current.trim() !== heading) flush(false)
        heading = block.replace(/^#{1,6}\s+/, '')
        current = heading
        page = section.page ?? null
        continue
      }
      for (const piece of splitLong(block, target)) {
        if (!current.trim() || current.trim() === heading) page = section.page ?? null
        if (current && current.length + piece.length + 2 > target) {
          flush(true)
          page = section.page ?? null
        }
        current = current ? `${current}\n\n${piece}` : piece
      }
    }
  }
  if (current.trim() && current.trim() !== heading) flush(false)
  return chunks
}

/** The last ~`size` characters, starting at a sentence or word boundary. */
function tailOf(text: string, size: number): string {
  if (size <= 0 || text.length <= size) return ''
  const slice = text.slice(-size)
  const sentence = slice.search(/(?<=[.!?])\s+/)
  if (sentence >= 0 && sentence < size / 2) return slice.slice(sentence).trim()
  const space = slice.indexOf(' ')
  return (space >= 0 ? slice.slice(space) : slice).trim()
}

/** A paragraph longer than a chunk is split at sentences, then at words. */
function splitLong(block: string, max: number): string[] {
  if (block.length <= max) return [block]
  const out: string[] = []
  let cur = ''
  for (const sentence of block.split(/(?<=[.!?])\s+/)) {
    if (sentence.length > max) {
      if (cur) out.push(cur)
      cur = ''
      for (let i = 0; i < sentence.length; i += max) {
        let end = Math.min(sentence.length, i + max)
        const space = sentence.lastIndexOf(' ', end)
        if (end < sentence.length && space > i + max / 2) end = space
        out.push(sentence.slice(i, end).trim())
        i = end - max
      }
      continue
    }
    if (cur && cur.length + sentence.length + 1 > max) {
      out.push(cur)
      cur = sentence
    } else cur = cur ? `${cur} ${sentence}` : sentence
  }
  if (cur) out.push(cur)
  return out.filter(Boolean)
}

/** Each FAQ pair is exactly one chunk. */
export function faqChunks(pairs: Array<{ question: string; answer: string }>): Chunk[] {
  return pairs.map((p, i) => ({
    ordinal: i,
    content: `Q: ${p.question.trim()}\nA: ${p.answer.trim()}`,
    page: null,
  }))
}

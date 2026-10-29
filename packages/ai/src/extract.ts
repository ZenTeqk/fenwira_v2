/**
 * Text extraction for knowledge documents (docs/AI_ASSISTANT.md → Ingestion). PDF text layer per
 * page (no OCR), DOCX raw text, and plain text for TXT/MD/CSV.
 */

export const KNOWLEDGE_FILE_TYPES = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
} as const
export type KnowledgeFileKind = (typeof KNOWLEDGE_FILE_TYPES)[keyof typeof KNOWLEDGE_FILE_TYPES]

export type TextSection = { text: string; page?: number }

/** A document we can read but cannot use. `message` is shown to the customer as is. */
export class ExtractionError extends Error {
  constructor(
    readonly code: 'SCANNED_PDF' | 'EMPTY_DOCUMENT' | 'UNREADABLE_DOCUMENT',
    message: string,
  ) {
    super(message)
    this.name = 'ExtractionError'
  }
}

export const SCANNED_PDF_MESSAGE = 'This PDF looks scanned. Upload a text-based version.'

/** Fewer letters than this per page on average = no usable text layer. */
const MIN_PDF_CHARS_PER_PAGE = 20

export async function extractText(
  bytes: Uint8Array,
  kind: KnowledgeFileKind,
): Promise<TextSection[]> {
  let sections: TextSection[]
  try {
    sections = await extractRaw(bytes, kind)
  } catch (err) {
    if (err instanceof ExtractionError) throw err
    throw new ExtractionError(
      'UNREADABLE_DOCUMENT',
      'We could not read this file. Check that it opens on your computer, then upload it again.',
    )
  }
  const cleaned = sections
    .map((s) => ({ ...s, text: normalize(s.text) }))
    .filter((s) => s.text.length > 0)
  if (!cleaned.length)
    throw new ExtractionError('EMPTY_DOCUMENT', 'This document has no text we can use.')
  return cleaned
}

async function extractRaw(bytes: Uint8Array, kind: KnowledgeFileKind): Promise<TextSection[]> {
  switch (kind) {
    case 'pdf': {
      const { extractText: pdfText, getDocumentProxy } = await import('unpdf')
      const pdf = await getDocumentProxy(new Uint8Array(bytes))
      const { totalPages, text } = await pdfText(pdf, { mergePages: false })
      const pages = text as string[]
      const letters = pages.reduce((n, p) => n + (p.match(/[A-Za-z0-9]/g)?.length ?? 0), 0)
      if (letters < Math.max(1, totalPages) * MIN_PDF_CHARS_PER_PAGE)
        throw new ExtractionError('SCANNED_PDF', SCANNED_PDF_MESSAGE)
      return pages.map((t, i) => ({ text: t, page: i + 1 }))
    }
    case 'docx': {
      const mammoth = await import('mammoth')
      const out = await mammoth.extractRawText({ buffer: Buffer.from(bytes) })
      return [{ text: out.value }]
    }
    case 'csv':
      return [{ text: csvToText(decode(bytes)) }]
    default:
      return [{ text: decode(bytes) }]
  }
}

function decode(bytes: Uint8Array): string {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** "Header: value" lines per row, so a row retrieved alone still says what each value is. */
export function csvToText(csv: string): string {
  const rows = parseCsv(csv).filter((r) => r.some((c) => c.trim()))
  if (rows.length < 2) return rows.map((r) => r.join(', ')).join('\n')
  const [header, ...body] = rows
  return body
    .map((r) =>
      r
        .map((cell, i) =>
          cell.trim() ? `${header![i]?.trim() || `Column ${i + 1}`}: ${cell.trim()}` : '',
        )
        .filter(Boolean)
        .join('; '),
    )
    .join('\n\n')
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

function normalize(text: string): string {
  return (
    text
      .replace(/\r\n?/g, '\n')
      // Strips control characters PDF/DOCX extraction leaves behind (deliberate).
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

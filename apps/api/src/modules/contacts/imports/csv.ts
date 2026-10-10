import Papa from 'papaparse'
import { type Readable } from 'node:stream'

export type CsvRow = { row: number; record: Record<string, string> }

/**
 * Streams CSV records (UTF-8, BOM tolerated) with the header row as keys. `row` is the spreadsheet
 * line number (the header is row 1), so error reports match what the user sees in Excel/Sheets.
 */
export async function* readCsv(input: Readable): AsyncGenerator<CsvRow> {
  const parser = Papa.parse(Papa.NODE_STREAM_INPUT, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h: string) => h.replace(/^\uFEFF/, '').trim(),
  }) as unknown as NodeJS.ReadWriteStream & AsyncIterable<Record<string, unknown>>
  input.pipe(parser)
  let row = 1
  for await (const raw of parser) {
    row += 1
    const record: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw))
      if (k !== '__parsed_extra') record[k] = typeof v === 'string' ? v.trim() : ''
    yield { row, record }
  }
}

/** Header names in file order (the first record's keys). */
export const headersOf = (record: Record<string, string>) => Object.keys(record)

export function toCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  return Papa.unparse({ fields: columns, data: rows.map((r) => columns.map((c) => r[c] ?? '')) })
}

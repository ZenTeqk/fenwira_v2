'use client'

import { type BreakdownRow } from '@fenwira/contracts'
import { type ColumnDef, DataTable } from '@fenwira/ui'
import { count } from '@/lib/analytics'

export type BreakdownColumn = {
  key: string
  label: string
  format?: (v: number, row: BreakdownRow) => string
}

/** One breakdown dimension (category, source, number, reason…) as a table. */
export function BreakdownTable({
  label,
  dimension,
  rows,
  columns,
  empty = 'Nothing in this period.',
}: {
  label: string
  dimension: string
  rows: BreakdownRow[]
  columns: BreakdownColumn[]
  empty?: string
}) {
  const defs: Array<ColumnDef<BreakdownRow>> = [
    {
      id: 'label',
      header: dimension,
      cell: ({ row }) => <span className="text-fg">{row.original.label}</span>,
    },
    ...columns.map((c): ColumnDef<BreakdownRow> => ({
      id: c.key,
      header: c.label,
      meta: { align: 'right' },
      cell: ({ row }) =>
        (c.format ?? ((v: number) => count(v)))(row.original.values[c.key] ?? 0, row.original),
    })),
  ]
  return (
    <DataTable
      label={label}
      columns={defs}
      data={rows}
      getRowId={(r) => r.key}
      empty={{ title: empty }}
    />
  )
}

'use client'

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type RowSelectionState,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { cn } from '../lib/cn'
import { focusRing } from '../lib/focus'
import { Checkbox } from './choice'
import { Pagination, type PaginationProps } from './pagination'
import { Skeleton } from './skeleton'
import { EmptyState, ErrorState } from './states'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table'

export type { ColumnDef } from '@tanstack/react-table'

export type DataTableProps<Row> = {
  columns: ColumnDef<Row, unknown>[]
  data: Row[]
  /** Stable row id (used for selection). */
  getRowId: (row: Row) => string
  /** Accessible name for the table. */
  label: string
  selectable?: boolean
  onSelectionChange?: (ids: string[]) => void
  loading?: boolean
  /** Rendered instead of rows when loading fails. */
  error?: { message?: string; correlationId?: string; onRetry?: () => void }
  empty?: { title: string; description?: ReactNode; action?: ReactNode }
  /** Cursor pagination controls under the table. */
  pagination?: PaginationProps
  skeletonRows?: number
}

/**
 * Dense list view: client-side sorting on the loaded page, row selection, cursor pagination,
 * and matching loading / empty / error states (docs/DESIGN_SYSTEM.md).
 */
export function DataTable<Row>({
  columns,
  data,
  getRowId,
  label,
  selectable,
  onSelectionChange,
  loading,
  error,
  empty,
  pagination,
  skeletonRows = 5,
}: DataTableProps<Row>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})

  const selectColumn: ColumnDef<Row, unknown> = {
    id: '__select',
    enableSorting: false,
    header: ({ table }) => (
      <Checkbox
        aria-label="Select all rows"
        checked={
          table.getIsAllRowsSelected()
            ? true
            : table.getIsSomeRowsSelected()
              ? 'indeterminate'
              : false
        }
        onCheckedChange={(value) => table.toggleAllRowsSelected(value === true)}
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        aria-label={`Select row ${row.id}`}
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(value === true)}
      />
    ),
  }

  const table = useReactTable({
    data,
    columns: selectable ? [selectColumn, ...columns] : columns,
    getRowId,
    state: { sorting, rowSelection },
    enableRowSelection: selectable,
    onSortingChange: setSorting,
    onRowSelectionChange: (updater) => {
      const next = typeof updater === 'function' ? updater(rowSelection) : updater
      setRowSelection(next)
      onSelectionChange?.(Object.keys(next).filter((id) => next[id]))
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const columnCount = table.getVisibleLeafColumns().length

  return (
    <div data-slot="data-table" className="flex flex-col gap-3">
      <Table aria-label={label} aria-busy={loading || undefined}>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} className="hover:bg-transparent">
              {group.headers.map((header) => {
                const sortable = header.column.getCanSort()
                const sorted = header.column.getIsSorted()
                const content = header.isPlaceholder
                  ? null
                  : flexRender(header.column.columnDef.header, header.getContext())
                return (
                  <TableHead
                    key={header.id}
                    className={header.column.id === '__select' ? 'w-10' : undefined}
                    aria-sort={
                      sorted === 'asc'
                        ? 'ascending'
                        : sorted === 'desc'
                          ? 'descending'
                          : sortable
                            ? 'none'
                            : undefined
                    }
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className={cn(
                          '-ml-1 inline-flex items-center gap-1 rounded-sm px-1 hover:text-slate',
                          focusRing,
                        )}
                      >
                        {content}
                        {sorted === 'asc' ? (
                          <ArrowUp className="size-3.5" aria-hidden="true" />
                        ) : sorted === 'desc' ? (
                          <ArrowDown className="size-3.5" aria-hidden="true" />
                        ) : (
                          <ChevronsUpDown className="size-3.5 text-slate-400" aria-hidden="true" />
                        )}
                      </button>
                    ) : (
                      content
                    )}
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {error ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columnCount}>
                <ErrorState
                  description={error.message}
                  correlationId={error.correlationId}
                  onRetry={error.onRetry}
                />
              </TableCell>
            </TableRow>
          ) : loading ? (
            Array.from({ length: skeletonRows }, (_, i) => (
              <TableRow key={`skeleton-${i}`} className="hover:bg-transparent">
                {Array.from({ length: columnCount }, (__, j) => (
                  <TableCell key={j}>
                    <Skeleton className="h-4 w-full max-w-40" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : table.getRowModel().rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columnCount}>
                <EmptyState
                  title={empty?.title ?? 'Nothing here yet'}
                  description={empty?.description}
                  action={empty?.action}
                />
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} data-state={row.getIsSelected() ? 'selected' : undefined}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {pagination && !error ? <Pagination {...pagination} /> : null}
    </div>
  )
}

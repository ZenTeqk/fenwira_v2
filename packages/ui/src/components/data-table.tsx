'use client'

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type RowSelectionState,
  type SortingState,
  useReactTable,
  type VisibilityState,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ChevronsUpDown, Columns3, MoreHorizontal } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Button } from './button'
import {
  Dropdown,
  DropdownCheckboxItem,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownTrigger,
} from './dropdown'
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
  /** Search and filters above the table (SearchInput, FilterBar children). */
  toolbar?: ReactNode
  /** Actions for the selected rows; the bar replaces nothing and appears only with a selection. */
  bulkActions?: (selectedIds: string[], clear: () => void) => ReactNode
  /** Adds a "Columns" menu. Columns opt out with `enableHiding: false`; menu names come from `meta.label`. */
  columnVisibility?: boolean
}

/** Column options read by DataTable (`meta` on a ColumnDef). */
export type DataTableColumnMeta = { label?: string; align?: 'left' | 'right' }

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
  toolbar,
  bulkActions,
  columnVisibility,
}: DataTableProps<Row>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [visibility, setVisibility] = useState<VisibilityState>({})

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
    state: { sorting, rowSelection, columnVisibility: visibility },
    onColumnVisibilityChange: setVisibility,
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
  const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id])
  const clearSelection = () => {
    setRowSelection({})
    onSelectionChange?.([])
  }
  const hideable = columnVisibility
    ? table.getAllLeafColumns().filter((c) => c.getCanHide() && c.id !== '__select')
    : []
  const metaOf = (c: { columnDef: { meta?: unknown } }) =>
    (c.columnDef.meta ?? {}) as DataTableColumnMeta

  return (
    <div data-slot="data-table" className="flex flex-col gap-3">
      {toolbar || hideable.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{toolbar}</div>
          {hideable.length ? (
            <Dropdown>
              <DropdownTrigger asChild>
                <Button variant="secondary" size="sm">
                  <Columns3 aria-hidden="true" />
                  Columns
                </Button>
              </DropdownTrigger>
              <DropdownContent>
                <DropdownLabel>Show columns</DropdownLabel>
                {hideable.map((c) => (
                  <DropdownCheckboxItem
                    key={c.id}
                    checked={c.getIsVisible()}
                    onCheckedChange={(v) => c.toggleVisibility(v === true)}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {metaOf(c).label ??
                      (typeof c.columnDef.header === 'string' ? c.columnDef.header : c.id)}
                  </DropdownCheckboxItem>
                ))}
              </DropdownContent>
            </Dropdown>
          ) : null}
        </div>
      ) : null}
      {bulkActions && selectedIds.length ? (
        <div
          role="region"
          aria-label="Bulk actions"
          className="flex flex-wrap items-center gap-2 rounded-md border border-border-control bg-surface-muted px-3 py-2"
        >
          <span className="text-base font-medium text-fg" aria-live="polite">
            {selectedIds.length} selected
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {bulkActions(selectedIds, clearSelection)}
          </div>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={clearSelection}>
            Clear selection
          </Button>
        </div>
      ) : null}
      <Table
        containerLabel={`${label} scroll area`}
        aria-label={label}
        aria-busy={loading || undefined}
      >
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
                    className={cn(
                      header.column.id === '__select' && 'w-10',
                      metaOf(header.column).align === 'right' && 'text-right',
                    )}
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
                          '-ml-1 inline-flex items-center gap-1 rounded-sm px-1 hover:text-fg',
                          focusRing,
                        )}
                      >
                        {content}
                        {sorted === 'asc' ? (
                          <ArrowUp className="size-3.5" aria-hidden="true" />
                        ) : sorted === 'desc' ? (
                          <ArrowDown className="size-3.5" aria-hidden="true" />
                        ) : (
                          <ChevronsUpDown className="size-3.5 text-fg-subtle" aria-hidden="true" />
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
                  <TableCell
                    key={cell.id}
                    className={
                      metaOf(cell.column).align === 'right' ? 'text-right tabular-nums' : undefined
                    }
                  >
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

export type RowAction = {
  label: string
  onSelect: () => void
  icon?: ReactNode
  destructive?: boolean
  disabled?: boolean
}

/** Trailing "⋯" menu for a row (UX_PATTERNS → Tables). */
export function RowActions({ label, actions }: { label: string; actions: RowAction[] }) {
  if (!actions.length) return null
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" aria-label={label}>
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownTrigger>
      <DropdownContent>
        {actions.map((a) => (
          <DropdownItem
            key={a.label}
            destructive={a.destructive}
            disabled={a.disabled}
            onSelect={a.onSelect}
          >
            {a.icon}
            {a.label}
          </DropdownItem>
        ))}
      </DropdownContent>
    </Dropdown>
  )
}

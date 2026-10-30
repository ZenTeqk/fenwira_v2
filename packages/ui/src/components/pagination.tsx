import { ChevronLeft, ChevronRight } from 'lucide-react'
import { type ReactNode } from 'react'
import { cn } from '../lib/cn'
import { Button } from './button'

/** Cursor pagination (docs/API_SPEC.md): previous/next only, no total page count. */
export type PaginationProps = {
  hasPrevious: boolean
  hasNext: boolean
  onPrevious: () => void
  onNext: () => void
  /** e.g. "Showing 26–50" */
  summary?: ReactNode
  className?: string
}

export function Pagination({
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  summary,
  className,
}: PaginationProps) {
  return (
    <nav
      aria-label="Pagination"
      className={cn('flex items-center justify-between gap-3', className)}
    >
      <p className="text-sm text-fg-muted" aria-live="polite">
        {summary}
      </p>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={onPrevious} disabled={!hasPrevious}>
          <ChevronLeft aria-hidden="true" />
          Previous
        </Button>
        <Button variant="secondary" size="sm" onClick={onNext} disabled={!hasNext}>
          Next
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </nav>
  )
}

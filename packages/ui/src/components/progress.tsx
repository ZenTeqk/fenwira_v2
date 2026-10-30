import { cn } from '../lib/cn'

/** Native, named progress with finite bounds. No visual-only or indeterminate fake percentage. */
export function Progress({
  label,
  value,
  max,
  className,
}: {
  label: string
  value: number
  max: number
  className?: string
}) {
  const bound = Number.isFinite(max) && max > 0 ? max : 1
  const current = Number.isFinite(value) ? Math.max(0, Math.min(bound, value)) : 0
  return (
    <progress
      aria-label={label}
      value={current}
      max={bound}
      className={cn(
        'h-1.5 w-full overflow-hidden rounded-full bg-surface-muted accent-action-primary [&::-moz-progress-bar]:bg-action-primary [&::-webkit-progress-bar]:bg-surface-muted [&::-webkit-progress-value]:bg-action-primary',
        className,
      )}
    />
  )
}

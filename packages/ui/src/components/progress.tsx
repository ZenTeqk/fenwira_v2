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
        'h-1.5 w-full overflow-hidden rounded-full bg-neutral-soft accent-primary-strong [&::-moz-progress-bar]:bg-primary-strong [&::-webkit-progress-bar]:bg-neutral-soft [&::-webkit-progress-value]:bg-primary-strong',
        className,
      )}
    />
  )
}

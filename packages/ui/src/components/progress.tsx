import { cn } from '../lib/cn'

const tones = {
  primary:
    'accent-action-primary [&::-moz-progress-bar]:bg-action-primary [&::-webkit-progress-value]:bg-action-primary',
  success:
    'accent-status-success [&::-moz-progress-bar]:bg-status-success [&::-webkit-progress-value]:bg-status-success',
  info: 'accent-status-info [&::-moz-progress-bar]:bg-status-info [&::-webkit-progress-value]:bg-status-info',
  warning:
    'accent-status-warning [&::-moz-progress-bar]:bg-status-warning [&::-webkit-progress-value]:bg-status-warning',
} as const

/** Native, named progress with finite bounds. No visual-only or indeterminate fake percentage. */
export function Progress({
  label,
  value,
  max,
  tone = 'primary',
  className,
}: {
  label: string
  value: number
  max: number
  /** Fill color; the label and numbers carry the meaning (status is never color alone). */
  tone?: keyof typeof tones
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
        'h-1.5 w-full overflow-hidden rounded-full bg-surface-muted [&::-webkit-progress-bar]:bg-surface-muted',
        tones[tone],
        className,
      )}
    />
  )
}

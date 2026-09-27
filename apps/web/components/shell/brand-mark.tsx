import { cn } from '@fenwira/ui'

/** The Fenwira wordmark. `dark` sits on the slate sidebar. */
export function BrandMark({
  tone = 'light',
  size = 'md',
  compact = false,
  className,
}: {
  tone?: 'light' | 'dark'
  size?: 'md' | 'lg'
  /** Initial only (collapsed sidebar). */
  compact?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-baseline font-semibold tracking-tight',
        size === 'lg' ? 'text-xl' : 'text-lg',
        tone === 'dark' ? 'text-surface' : 'text-slate',
        className,
      )}
    >
      {compact ? 'F' : 'Fenwira'}
      <span className={tone === 'dark' ? 'text-primary' : 'text-primary-strong'} aria-hidden="true">
        .
      </span>
    </span>
  )
}

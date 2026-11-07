import { cn } from '@fenwira/ui'
import Image from 'next/image'

/**
 * Fenwira brand (docs/brand/README.md).
 * - `mark` (default): the F mark with the live "Fenwira" wordmark. `dark` sits on the slate
 *   sidebar; `compact` shows the mark alone (collapsed sidebar).
 * - `lockup`: the "Fenwira" lockup (sign-in, onboarding, invitations). Both artworks are rendered and
 *   the one matching the current theme is shown (`fw-theme-*-only`, packages/ui theme.css).
 */
export function BrandMark({
  tone = 'light',
  size = 'md',
  compact = false,
  variant = 'mark',
  className,
}: {
  tone?: 'light' | 'dark'
  size?: 'md' | 'lg'
  /** Mark only (collapsed sidebar). */
  compact?: boolean
  variant?: 'mark' | 'lockup'
  className?: string
}) {
  if (variant === 'lockup') {
    const img = cn('h-auto', size === 'lg' ? 'w-48' : 'w-36')
    return (
      <span className={cn('inline-block', className)}>
        <Image
          src="/brand/fenwira-lockup-light.png"
          alt="Fenwira"
          width={960}
          height={281}
          priority
          className={cn(img, 'fw-theme-light-only')}
        />
        <Image
          src="/brand/fenwira-lockup-dark.png"
          alt="Fenwira"
          width={960}
          height={278}
          priority
          className={cn(img, 'fw-theme-dark-only')}
        />
      </span>
    )
  }
  const px = size === 'lg' ? 32 : 28
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 font-semibold tracking-tight',
        size === 'lg' ? 'text-xl' : 'text-lg',
        tone === 'dark' ? 'text-surface' : 'text-fg',
        className,
      )}
    >
      <Image
        src="/brand/fenwira-mark.png"
        alt={compact ? 'Fenwira' : ''}
        width={px}
        height={px}
        priority
        className="shrink-0"
      />
      {compact ? null : 'Fenwira'}
    </span>
  )
}

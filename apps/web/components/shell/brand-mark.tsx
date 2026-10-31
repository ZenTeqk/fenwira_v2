import { cn } from '@fenwira/ui'
import Image from 'next/image'

/**
 * Fenwira brand (docs/brand/README.md).
 * - `mark` (default): the F mark with the live "Fenwira" wordmark. `dark` sits on the slate
 *   sidebar; `compact` shows the mark alone (collapsed sidebar).
 * - `lockup`: the "Fenwira by ZenteqK" lockup for light surfaces (sign-in, onboarding, invitations).
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
  if (variant === 'lockup')
    return (
      <Image
        src="/brand/fenwira-lockup-light.png"
        alt="Fenwira by ZenteqK"
        width={960}
        height={299}
        priority
        className={cn('h-auto', size === 'lg' ? 'w-48' : 'w-36', className)}
      />
    )
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

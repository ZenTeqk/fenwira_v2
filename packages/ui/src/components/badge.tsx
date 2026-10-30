import { cva, type VariantProps } from 'class-variance-authority'
import { type ComponentProps, type ReactNode } from 'react'
import { cn } from '../lib/cn'

/**
 * Soft tint background + slate text (AA on every tint) + tone-colored icon/dot.
 * Tone color never carries the meaning alone: the label always does (FENWIRA_DESIGN_SYSTEM → Status).
 */
export const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium text-fg [&_svg]:size-3.5',
  {
    variants: {
      tone: {
        neutral: 'bg-surface-muted [&_[data-tone-icon]]:text-fg-muted',
        primary: 'bg-action-primary-subtle [&_[data-tone-icon]]:text-action-primary',
        success: 'bg-status-success-bg [&_[data-tone-icon]]:text-status-success-fg',
        warning: 'bg-status-warning-bg [&_[data-tone-icon]]:text-status-warning-fg',
        danger: 'bg-status-error-bg [&_[data-tone-icon]]:text-status-error-fg',
        info: 'bg-status-info-bg [&_[data-tone-icon]]:text-status-info-fg',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>

export type BadgeProps = ComponentProps<'span'> &
  VariantProps<typeof badgeVariants> & { icon?: ReactNode }

export function Badge({ className, tone, icon, children, ...props }: BadgeProps) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ tone }), className)} {...props}>
      {icon ? (
        <span data-tone-icon="" className="inline-flex" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  )
}

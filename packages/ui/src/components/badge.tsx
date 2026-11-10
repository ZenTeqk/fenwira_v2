import { cva, type VariantProps } from 'class-variance-authority'
import { type ComponentProps, type ReactNode } from 'react'
import { cn } from '../lib/cn'

/**
 * Static, non-interactive chip: a muted tint with readable text in the same hue and a matching
 * icon (AA on every tint, tokens.test.ts). Tone colour never carries the meaning alone: the label
 * always does (FENWIRA_DESIGN_SYSTEM → Status). `label-*` tones are user-chosen contact-label
 * colours: decorative identity, never a status.
 */
export const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium text-fg [&_svg]:size-3.5',
  {
    variants: {
      tone: {
        neutral: 'bg-status-neutral-bg text-status-neutral-fg',
        primary: 'bg-action-primary-subtle text-action-primary-subtle-fg',
        success: 'bg-status-success-bg text-status-success-fg',
        warning: 'bg-status-warning-bg text-status-warning-fg',
        danger: 'bg-status-error-bg text-status-error-fg',
        info: 'bg-status-info-bg text-status-info-fg',
        'label-blue': 'bg-label-blue-bg text-label-blue-fg',
        'label-green': 'bg-label-green-bg text-label-green-fg',
        'label-amber': 'bg-label-amber-bg text-label-amber-fg',
        'label-rose': 'bg-label-rose-bg text-label-rose-fg',
        'label-teal': 'bg-label-teal-bg text-label-teal-fg',
        'label-neutral': 'bg-label-neutral-bg text-label-neutral-fg',
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

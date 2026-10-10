import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { Slot } from 'radix-ui'
import { type ComponentProps } from 'react'
import { cn } from '../lib/cn'
import { focusRing } from '../lib/focus'

export const buttonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-sm font-medium',
    'transition-colors select-none disabled:pointer-events-none disabled:opacity-50',
    '[&_svg]:size-4 [&_svg]:shrink-0',
    focusRing,
  ],
  {
    variants: {
      variant: {
        // -strong fills keep white text at WCAG AA (docs/DESIGN_SYSTEM.md).
        primary: 'bg-primary-strong text-surface hover:bg-primary-strong-hover',
        secondary: 'border border-border bg-surface text-slate hover:bg-neutral-soft',
        ghost: 'text-slate hover:bg-neutral-soft',
        danger: 'bg-danger-strong text-surface hover:bg-danger-strong-hover',
        link: 'h-auto px-0 text-primary-strong underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-3 text-sm',
        md: 'h-9 px-4 text-base',
        lg: 'h-10 px-5 text-md',
        icon: 'size-9',
      },
    },
    compoundVariants: [{ variant: 'link', className: 'h-auto px-0' }],
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

export type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    /** Render the child element (e.g. a link) with button styling. */
    asChild?: boolean
    /** Shows a spinner, sets aria-busy and disables the button. */
    loading?: boolean
  }

export function Button({
  className,
  variant,
  size,
  asChild,
  loading,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={asChild ? undefined : disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && !asChild ? (
        <>
          <Loader2 className="animate-spin" aria-hidden="true" />
          {children}
        </>
      ) : (
        children
      )}
    </Comp>
  )
}

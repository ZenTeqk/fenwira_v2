import { cva, type VariantProps } from 'class-variance-authority'
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import { type ComponentProps, type ReactNode } from 'react'
import { cn } from '../lib/cn'

const alertVariants = cva(
  'flex flex-wrap gap-3 rounded-md border border-l-4 p-3 text-base text-fg',
  {
    variants: {
      tone: {
        info: 'border-status-info-border border-l-status-info bg-status-info-bg',
        success: 'border-status-success-border border-l-status-success bg-status-success-bg',
        warning: 'border-status-warning-border border-l-status-warning bg-status-warning-bg',
        danger: 'border-status-error-border border-l-status-error bg-status-error-bg',
      },
    },
    defaultVariants: { tone: 'info' },
  },
)

const icons = {
  info: <Info className="size-5 text-status-info-fg" aria-hidden="true" />,
  success: <CheckCircle2 className="size-5 text-status-success-fg" aria-hidden="true" />,
  warning: <AlertTriangle className="size-5 text-status-warning-fg" aria-hidden="true" />,
  danger: <XCircle className="size-5 text-status-error-fg" aria-hidden="true" />,
}

export type AlertProps = Omit<ComponentProps<'div'>, 'title'> &
  VariantProps<typeof alertVariants> & { title?: ReactNode; action?: ReactNode }

/** Inline message. Danger alerts are announced assertively (role="alert"); others politely. */
export function Alert({
  className,
  tone = 'info',
  title,
  action,
  children,
  role,
  ...props
}: AlertProps) {
  const t = tone ?? 'info'
  return (
    <div
      data-slot="alert"
      role={role ?? (t === 'danger' ? 'alert' : 'status')}
      className={cn(alertVariants({ tone: t }), className)}
      {...props}
    >
      <span className="mt-0.5 shrink-0">{icons[t]}</span>
      <div className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="text-fg">{children}</div> : null}
      </div>
      {/* Beside the text when there's room; on its own line (aligned with the text) when narrow. */}
      {action ? <div className="ml-8 shrink-0 self-center sm:ml-0">{action}</div> : null}
    </div>
  )
}

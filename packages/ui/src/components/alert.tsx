import { cva, type VariantProps } from 'class-variance-authority'
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import { type ComponentProps, type ReactNode } from 'react'
import { cn } from '../lib/cn'

const alertVariants = cva('flex gap-3 rounded-md border border-l-4 p-3 text-base text-slate', {
  variants: {
    tone: {
      info: 'border-info/30 border-l-info bg-info-soft',
      success: 'border-success/40 border-l-success bg-success-soft',
      warning: 'border-warning/40 border-l-warning bg-warning-soft',
      danger: 'border-danger/30 border-l-danger bg-danger-soft',
    },
  },
  defaultVariants: { tone: 'info' },
})

const icons = {
  info: <Info className="size-5 text-info-strong" aria-hidden="true" />,
  success: <CheckCircle2 className="size-5 text-primary-strong" aria-hidden="true" />,
  warning: <AlertTriangle className="size-5 text-warning" aria-hidden="true" />,
  danger: <XCircle className="size-5 text-danger-strong" aria-hidden="true" />,
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
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="text-slate">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
    </div>
  )
}

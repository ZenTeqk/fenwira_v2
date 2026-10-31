import { Card } from '@fenwira/ui'
import type { ReactNode } from 'react'

export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <Card className="flex flex-col gap-6 p-6 sm:p-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-fg">{title}</h1>
        {description ? <p className="text-base text-fg-muted">{description}</p> : null}
      </div>
      {children}
      {footer ? (
        <div className="border-t border-border-subtle pt-4 text-center text-sm text-fg-muted">
          {footer}
        </div>
      ) : null}
    </Card>
  )
}

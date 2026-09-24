import { type ReactNode } from 'react'
import { cn } from '../lib/cn'
import { Breadcrumb, type BreadcrumbItem, type LinkComponent } from './breadcrumb'

export type PageHeaderProps = {
  title: string
  description?: ReactNode
  breadcrumbs?: BreadcrumbItem[]
  linkAs?: LinkComponent
  actions?: ReactNode
  className?: string
}

export function PageHeader({
  title,
  description,
  breadcrumbs,
  linkAs,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header data-slot="page-header" className={cn('flex flex-col gap-3', className)}>
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <Breadcrumb items={breadcrumbs} linkAs={linkAs} />
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-semibold text-slate">{title}</h1>
          {description ? <p className="max-w-2xl text-base text-muted">{description}</p> : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </header>
  )
}

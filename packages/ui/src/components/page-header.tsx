import { type ReactNode } from 'react'
import { cn } from '../lib/cn'
import { Breadcrumb, type BreadcrumbItem, type LinkComponent } from './breadcrumb'

export type PageHeaderProps = {
  title: string
  description?: ReactNode
  /** Keep a long purpose line below the title/action row. */
  descriptionFullWidth?: boolean
  breadcrumbs?: BreadcrumbItem[]
  linkAs?: LinkComponent
  actions?: ReactNode
  className?: string
}

export function PageHeader({
  title,
  description,
  descriptionFullWidth = false,
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
          {description && !descriptionFullWidth ? (
            <p className="max-w-2xl text-base text-muted">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {description && descriptionFullWidth ? (
        <p className="-mt-2 text-base text-muted">{description}</p>
      ) : null}
    </header>
  )
}

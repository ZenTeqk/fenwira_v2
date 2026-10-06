import { type ReactNode } from 'react'
import { cn } from '../lib/cn'
import { PageHeader, type PageHeaderProps } from './page-header'

/**
 * Page patterns (docs/design/UX_PATTERNS.md → Page patterns). Feature pages compose these instead
 * of building their own page structure, so spacing, heading order and banners stay consistent.
 */

type HeaderProps = Omit<PageHeaderProps, 'className'>

/** Record collection: header → banners → table (with its toolbar). */
export function ListPage({
  header,
  banner,
  children,
  className,
}: {
  header: HeaderProps
  /** Persistent conditions (Alert) above the collection. */
  banner?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div data-pattern="list-page" className={cn('flex flex-col gap-6', className)}>
      <PageHeader {...header} />
      {banner}
      {children}
    </div>
  )
}

/** One record: header with status and actions → banner → summary → sections (usually Tabs). */
export function DetailPage({
  header,
  banner,
  summary,
  children,
  className,
}: {
  header: HeaderProps
  banner?: ReactNode
  /** A strip of key facts under the header. */
  summary?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div data-pattern="detail-page" className={cn('flex flex-col gap-6', className)}>
      <PageHeader {...header} />
      {banner}
      {summary ? (
        <dl className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-surface p-4 md:grid-cols-4">
          {summary}
        </dl>
      ) : null}
      {children}
    </div>
  )
}

/** One fact in a DetailPage summary strip. */
export function SummaryItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-sm text-secondary">{label}</dt>
      <dd className="min-w-0 font-medium text-slate">{children}</dd>
    </div>
  )
}

/** Editors: header (state + commit action) → palette · work area · inspector → footer. */
export function BuilderPage({
  header,
  banner,
  palette,
  inspector,
  footer,
  children,
  className,
}: {
  header: HeaderProps
  banner?: ReactNode
  palette?: ReactNode
  inspector?: ReactNode
  /** Validation or summary under the work area. */
  footer?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div data-pattern="builder-page" className={cn('flex flex-col gap-4', className)}>
      <PageHeader {...header} />
      {banner}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        {palette ? <div className="shrink-0 lg:w-52">{palette}</div> : null}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {children}
          {footer}
        </div>
        {inspector ? (
          <aside className="shrink-0 rounded-lg border border-border bg-surface p-4 lg:sticky lg:top-20 lg:w-80">
            {inspector}
          </aside>
        ) : null}
      </div>
    </div>
  )
}

/** Settings: header → stacked cards, each saving on its own. */
export function SettingsPage({
  header,
  banner,
  children,
  className,
}: {
  header: HeaderProps
  banner?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div data-pattern="settings-page" className={cn('flex max-w-4xl flex-col gap-6', className)}>
      <PageHeader {...header} />
      {banner}
      {children}
    </div>
  )
}

/** Home: attention/current activity → conversations/automations → compact secondary metrics. */
export function DashboardLayout({
  header,
  attention,
  metrics,
  children,
  aside,
  className,
}: {
  header: HeaderProps
  attention?: ReactNode
  metrics?: ReactNode
  children?: ReactNode
  aside?: ReactNode
  className?: string
}) {
  return (
    <div data-pattern="dashboard" className={cn('flex flex-col gap-6', className)}>
      <PageHeader {...header} />
      {attention || aside ? (
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
          <div className="min-w-0 xl:col-span-2">{attention}</div>
          {aside ? <div className="flex min-w-0 flex-col gap-4">{aside}</div> : null}
        </div>
      ) : null}
      {children}
      {metrics ? (
        <section
          aria-label="Workspace summary"
          className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-surface p-2 sm:grid-cols-2 xl:grid-cols-4"
        >
          {metrics}
        </section>
      ) : null}
    </div>
  )
}

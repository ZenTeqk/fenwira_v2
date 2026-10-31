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
        <dl className="grid grid-cols-2 gap-4 rounded-lg border border-border-subtle bg-surface p-4 md:grid-cols-4">
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
      <dt className="text-sm text-fg-secondary">{label}</dt>
      {/* Long unbroken values (emails, IDs) wrap instead of widening the page. */}
      <dd className="min-w-0 font-medium wrap-anywhere text-fg">{children}</dd>
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
  appearance = 'default',
  topbar,
}: {
  topbar?: ReactNode
  appearance?: 'default' | 'studio' | 'canvas'
  header: HeaderProps
  banner?: ReactNode
  palette?: ReactNode
  inspector?: ReactNode
  /** Validation or summary under the work area. */
  footer?: ReactNode
  children: ReactNode
  className?: string
}) {
  if (appearance === 'canvas')
    return (
      <main
        data-pattern="builder-page"
        className="flex h-dvh min-h-0 flex-col overflow-hidden bg-canvas text-fg"
      >
        {topbar}
        {banner}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {palette ? (
            <aside
              aria-label="Node library"
              className="hidden w-56 shrink-0 overflow-y-auto border-r border-border-subtle bg-surface p-3 md:block"
            >
              {palette}
            </aside>
          ) : null}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {children}
            {footer}
          </div>
          {inspector ? (
            <aside
              aria-label="Step settings and preview"
              className="flex min-h-0 w-96 shrink-0 flex-col overflow-y-auto border-l border-border-subtle bg-surface p-3"
            >
              {inspector}
            </aside>
          ) : null}
        </div>
      </main>
    )
  return (
    <div data-pattern="builder-page" className={cn('flex flex-col gap-4', className)}>
      <PageHeader {...header} />
      {banner}
      <div
        className={cn(
          'flex min-w-0 flex-col lg:flex-row lg:items-start',
          appearance === 'studio'
            ? 'overflow-hidden rounded-lg border border-border-subtle bg-surface gap-0'
            : 'gap-4',
        )}
      >
        {palette ? (
          <div
            className={cn(
              'shrink-0 lg:w-52',
              appearance === 'studio' &&
                'hidden lg:block border-b border-border-subtle p-3 lg:max-h-192 lg:overflow-y-auto lg:border-b-0 lg:border-r',
            )}
          >
            {palette}
          </div>
        ) : null}
        <div
          className={cn(
            'flex min-w-0 flex-1 flex-col gap-4',
            appearance === 'studio' && 'bg-canvas',
          )}
        >
          {children}
          {footer}
        </div>
        {inspector ? (
          <aside
            className={cn(
              'shrink-0 bg-surface p-4 lg:w-80',
              appearance === 'studio'
                ? 'border-t border-border-subtle xl:max-h-192 xl:overflow-y-auto lg:border-t-0 lg:border-l'
                : 'rounded-lg border border-border-subtle lg:sticky lg:top-20',
            )}
          >
            {inspector}
          </aside>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Settings: header → stacked cards, each saving on its own. The page uses the same content width
 * as every other module; only the cards and forms inside it are capped for readable line length.
 */
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
    <div
      data-pattern="settings-page"
      className={cn(
        'flex w-full flex-col gap-6 [&>:not([data-slot=page-header])]:max-w-4xl',
        className,
      )}
    >
      <PageHeader {...header} />
      {banner}
      {children}
    </div>
  )
}

/** Home composition: attention/update timeline → conversations + commercial snapshot → flows. */
export function DashboardLayout({
  header,
  attention,
  metrics,
  children,
  aside,
  conversations,
  campaign,
  automation,
  summaryNote,
  className,
}: {
  header: HeaderProps
  attention?: ReactNode
  metrics?: ReactNode
  children?: ReactNode
  aside?: ReactNode
  conversations?: ReactNode
  campaign?: ReactNode
  automation?: ReactNode
  summaryNote?: ReactNode
  className?: string
}) {
  return (
    <div data-pattern="dashboard" className={cn('flex flex-col gap-4', className)}>
      <PageHeader
        {...header}
        className="mb-1 [&_h1]:text-2xl [&_h1]:font-semibold [&_p]:text-base"
      />
      <div className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-10">
        <div className="min-w-0 xl:col-span-7 [&>div]:h-full">{attention}</div>
        {aside ? <div className="min-w-0 xl:col-span-3 [&>div]:h-full">{aside}</div> : null}
      </div>
      <div className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-9">
        {conversations ? (
          <div className="min-w-0 xl:col-span-4 [&>div]:h-full">{conversations}</div>
        ) : null}
        <div
          className={cn(
            'flex min-w-0 flex-col gap-4',
            conversations ? 'xl:col-span-5' : 'xl:col-span-9',
          )}
        >
          {campaign}
          {metrics ? (
            <section
              aria-label="Workspace summary"
              className="rounded-lg border border-border-subtle bg-surface px-3 py-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 px-2">
                <h2 className="text-md font-semibold text-fg">Workspace summary</h2>
                {summaryNote}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-y-3 divide-x divide-border-subtle md:grid-cols-4">
                {metrics}
              </div>
            </section>
          ) : null}
        </div>
      </div>
      {automation}
      {children}
    </div>
  )
}

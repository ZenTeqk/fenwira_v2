'use client'

import { TEMPLATE_CATEGORIES, TEMPLATE_STATUSES, type Template } from '@fenwira/contracts'
import {
  Alert,
  Button,
  Card,
  CardContent,
  Badge,
  EmptyState,
  ErrorState,
  FilterBar,
  cn,
  focusRing,
  ListPage,
  PermissionState,
  SearchInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from '@fenwira/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  Eye,
  Languages,
  Megaphone,
  Package,
  Plus,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import Link from 'next/link'
import { useRef, useState } from 'react'
import { useDebounced } from '@/components/inbox/conversation-list'
import { useSession } from '@/components/session/session-provider'
import { TemplateContext } from '@/components/templates/template-context'
import { TemplateMessage } from '@/components/templates/template-message'
import { ApiError, post } from '@/lib/api/client'
import { relativeTime } from '@/lib/relative-time'
import {
  CATEGORY_LABEL,
  languageLabel,
  TEMPLATE_LANGUAGES,
  templatesKey,
  useTemplates,
  useApprovedTemplates,
} from '@/lib/templates'

const ALL = 'ALL'
const CATEGORY_PRESENTATION = {
  UTILITY: { icon: Package, className: 'bg-info-soft text-info-strong' },
  MARKETING: { icon: Megaphone, className: 'bg-category-marketing-bg text-category-marketing-fg' },
  AUTHENTICATION: {
    icon: ShieldCheck,
    className: 'bg-category-authentication-bg text-category-authentication-fg',
  },
}
function displayTitle(name: string) {
  const words = name.replace(/[_-]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
const VIEWS = [
  { id: ALL, label: 'All', statuses: [] },
  { id: 'APPROVED', label: 'Approved', statuses: ['APPROVED'] },
  { id: 'PENDING', label: 'In review', statuses: ['PENDING'] },
  { id: 'DRAFT', label: 'Drafts', statuses: ['DRAFT'] },
  { id: 'ATTENTION', label: 'Needs attention', statuses: ['REJECTED', 'PAUSED', 'DISABLED'] },
]
function Filter({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="h-9 w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{`Any ${label.toLowerCase()}`}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
function TemplateStatus({ template: t }: { template: Template }) {
  const colors =
    t.status === 'APPROVED'
      ? 'bg-status-success-bg text-status-success-fg'
      : t.status === 'PENDING'
        ? 'bg-status-warning-bg text-warning-strong'
        : ['REJECTED', 'PAUSED', 'DISABLED'].includes(t.status)
          ? 'bg-status-error-bg text-danger-strong'
          : 'bg-neutral-soft text-secondary'
  return (
    <span className="flex shrink-0 flex-col items-end gap-1.5">
      <StatusBadge
        status={t.status}
        className={cn('rounded-full [&_[data-tone-icon]]:text-inherit', colors)}
        label={t.status === 'PENDING' ? 'In review' : undefined}
      />
      {t.currentVersion.lastError && !['REJECTED', 'PAUSED', 'DISABLED'].includes(t.status) ? (
        <StatusBadge
          status="ATTENTION"
          label="Needs attention"
          className="rounded-full bg-status-error-bg text-danger-strong [&_[data-tone-icon]]:text-inherit"
        />
      ) : null}
      {t.qualityScore && t.qualityScore !== 'UNKNOWN' ? (
        <StatusBadge status={t.qualityScore as 'GREEN' | 'YELLOW' | 'RED'} />
      ) : null}
    </span>
  )
}

/** Reusable WhatsApp messages; lifecycle and sending remain in their existing domain routes. */
export default function TemplatesPage() {
  const { tenantId, can } = useSession()
  const queryClient = useQueryClient()
  const [q, setQ] = useState('')
  const [view, setView] = useState(ALL)
  const [category, setCategory] = useState(ALL)
  const [language, setLanguage] = useState(ALL)
  const [status, setStatus] = useState(ALL)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const search = useDebounced(q.trim())
  const templates = useTemplates(
    new URLSearchParams({
      ...(search ? { q: search } : {}),
      ...(category !== ALL ? { category } : {}),
      ...(language !== ALL ? { language } : {}),
      ...(status !== ALL ? { status } : {}),
    }),
  )
  const approved = useApprovedTemplates(undefined, Boolean(selectedId))
  const sync = useMutation({
    mutationFn: () =>
      post<{ data: Array<{ imported: number; updated: number }> }>('/templates/sync', {}),
    onSuccess: (r) => {
      const imported = r.data.reduce((n, x) => n + x.imported, 0)
      const updated = r.data.reduce((n, x) => n + x.updated, 0)
      toast.success(`Synced from Meta: ${imported} new, ${updated} updated`)
      void queryClient.invalidateQueries({ queryKey: templatesKey(tenantId) })
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'The sync failed.'),
  })
  if (!can('templates.read')) return <PermissionState what="templates" />
  const all = templates.data ?? []
  const statuses = VIEWS.find((v) => v.id === view)?.statuses ?? []
  const visible = statuses.length
    ? all.filter(
        (t) =>
          statuses.includes(t.status) || (view === 'ATTENTION' && !!t.currentVersion.lastError),
      )
    : all
  const selected = all.find((t) => t.id === selectedId)
  const filtered = !!(
    search ||
    view !== ALL ||
    category !== ALL ||
    language !== ALL ||
    status !== ALL
  )
  const create = can('templates.write') ? (
    <Button asChild>
      <Link href="/templates/new">
        <Plus aria-hidden="true" />
        Create template
      </Link>
    </Button>
  ) : undefined
  const restoreFocus = () => {
    const original = trigger.current
    if (original?.getClientRects().length) original.focus()
    else
      document
        .querySelector<HTMLElement>(
          `[data-template-preview="${original?.dataset.templatePreview}"]`,
        )
        ?.focus()
  }
  return (
    <div className="fw-template-library flex min-w-0 items-start gap-4 bg-background">
      <ListPage
        className="min-w-0 flex-1 gap-4 [&_[data-slot=page-header]>div>div]:max-w-full"
        header={{
          title: 'Templates',
          description: 'Create and manage approved WhatsApp messages.',
          actions: can('templates.write') ? (
            <>
              <Button variant="secondary" loading={sync.isPending} onClick={() => sync.mutate()}>
                <RefreshCw aria-hidden="true" />
                Sync with WhatsApp
              </Button>
              {create}
            </>
          ) : null,
        }}
      >
        <Tabs value={view} onValueChange={setView}>
          <TabsList
            aria-label="Template views"
            className="border-0 [&_button]:min-h-10 [&_button]:text-sm"
          >
            {VIEWS.map((v) => {
              const count = v.statuses.length
                ? all.filter(
                    (t) =>
                      v.statuses.includes(t.status) ||
                      (v.id === 'ATTENTION' && !!t.currentVersion.lastError),
                  ).length
                : all.length
              return (
                <TabsTrigger key={v.id} value={v.id}>
                  {v.label}
                  {templates.data ? (
                    <Badge
                      tone="neutral"
                      className={cn(
                        'min-w-6 justify-center rounded-full px-1.5 tabular-nums text-secondary',
                        count > 0 &&
                          v.id === 'APPROVED' &&
                          'bg-status-success-bg text-status-success-fg',
                        count > 0 &&
                          v.id === 'PENDING' &&
                          'bg-status-warning-bg text-warning-strong',
                        count > 0 &&
                          v.id === 'ATTENTION' &&
                          'bg-status-error-bg text-danger-strong',
                      )}
                    >
                      {count}
                    </Badge>
                  ) : null}
                </TabsTrigger>
              )
            })}
          </TabsList>
          <div className="rounded-lg border border-border-subtle bg-surface p-3">
            <FilterBar
              activeCount={
                (search ? 1 : 0) +
                (category !== ALL ? 1 : 0) +
                (language !== ALL ? 1 : 0) +
                (status !== ALL ? 1 : 0)
              }
              onClear={() => {
                setQ('')
                setCategory(ALL)
                setLanguage(ALL)
                setView(ALL)
                setStatus(ALL)
              }}
            >
              <SearchInput
                label="Search templates"
                placeholder="Search templates…"
                className="w-full sm:w-64"
                value={q}
                onValueChange={setQ}
              />
              <Filter
                label="Category"
                value={category}
                onChange={setCategory}
                options={TEMPLATE_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))}
              />
              <Filter
                label="Language"
                value={language}
                onChange={setLanguage}
                options={Array.from(
                  new Set([
                    ...TEMPLATE_LANGUAGES.map((l) => l.code),
                    ...all.map((t) => t.language),
                  ]),
                ).map((code) => ({ value: code, label: languageLabel(code) }))}
              />
              <Filter
                label="Status"
                value={status}
                onChange={setStatus}
                options={TEMPLATE_STATUSES.map((value) => ({
                  value,
                  label:
                    value === 'PENDING'
                      ? 'In review'
                      : value.charAt(0) + value.slice(1).toLowerCase(),
                }))}
              />
            </FilterBar>
          </div>
          <TabsContent value={view} className="min-w-0">
            {templates.isPending ? (
              <div
                className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 xl:gap-5"
                aria-label="Loading templates"
                aria-busy="true"
              >
                {[0, 1, 2].map((n) => (
                  <Skeleton key={n} className="h-60" />
                ))}
              </div>
            ) : templates.isError ? (
              <ErrorState
                title="Templates couldn’t be loaded"
                description={
                  templates.error instanceof ApiError ? templates.error.message : undefined
                }
                onRetry={() => void templates.refetch()}
              />
            ) : !visible.length ? (
              <EmptyState
                title={filtered ? 'No matching templates' : 'Your message library starts here'}
                description={
                  filtered
                    ? 'Try another name, view, category or language.'
                    : 'Create a message for Meta to review, or sync templates from WhatsApp Manager.'
                }
                action={
                  filtered ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setQ('')
                        setCategory(ALL)
                        setLanguage(ALL)
                        setView(ALL)
                        setStatus(ALL)
                      }}
                    >
                      Clear filters
                    </Button>
                  ) : (
                    create
                  )
                }
              />
            ) : (
              <ul
                aria-label="Template library"
                className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 xl:gap-5"
              >
                {visible.map((t) => {
                  const presentation = CATEGORY_PRESENTATION[t.category]
                  const CategoryIcon = presentation.icon
                  const title = displayTitle(t.name)
                  return (
                    <li key={t.id} className="min-w-0">
                      <Card
                        className={cn(
                          'h-full border-border-subtle bg-surface shadow-none transition-shadow hover:border-primary-strong/30 hover:shadow-raised focus-within:border-primary-strong focus-within:shadow-raised motion-reduce:transition-none',
                          selectedId === t.id && 'border-primary-strong',
                        )}
                        data-template-card={t.id}
                      >
                        <CardContent className="flex h-full flex-col gap-3 p-4">
                          <div className="flex min-w-0 flex-col gap-3">
                            <div className="flex min-w-0 items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <h2>
                                  <Link
                                    href={`/templates/${t.id}`}
                                    className={cn(
                                      'line-clamp-2 break-words rounded-sm text-md font-semibold text-slate underline-offset-4 hover:underline',
                                      focusRing,
                                    )}
                                    title={title}
                                  >
                                    {title}
                                  </Link>
                                </h2>
                                <p className="mt-1 break-all text-xs text-muted">{t.name}</p>
                              </div>
                              <TemplateStatus template={t} />
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Badge className={cn('rounded-full', presentation.className)}>
                                <CategoryIcon aria-hidden="true" />
                                {CATEGORY_LABEL[t.category]}
                              </Badge>
                              <Badge
                                tone="neutral"
                                className="rounded-full font-normal text-secondary"
                              >
                                <Languages aria-hidden="true" />
                                {languageLabel(t.language)}
                              </Badge>
                            </div>
                          </div>
                          <TemplateMessage version={t.currentVersion} compact library />
                          {t.status === 'REJECTED' && t.currentVersion.rejectionReason ? (
                            <p className="line-clamp-2 text-xs text-secondary">
                              Meta: {t.currentVersion.rejectionReason}
                            </p>
                          ) : null}
                          {t.currentVersion.lastError ? (
                            <p className="line-clamp-2 text-xs text-secondary">
                              Last submission: {t.currentVersion.lastError}
                            </p>
                          ) : null}
                          <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
                            <span className="text-xs text-muted">
                              Updated {relativeTime(t.updatedAt)}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Preview ${t.name}`}
                              aria-current={selectedId === t.id ? 'true' : undefined}
                              data-template-preview={t.id}
                              className="h-8 rounded-md bg-action-primary-subtle px-2.5 text-sm text-status-success-fg hover:bg-action-primary-subtle-hover hover:text-primary-strong-hover"
                              onClick={(event) => {
                                trigger.current = event.currentTarget
                                setSelectedId(t.id)
                              }}
                            >
                              <Eye aria-hidden="true" />
                              Preview
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    </li>
                  )
                })}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      </ListPage>
      <TemplateContext
        name={selected?.name}
        onClose={() => setSelectedId(null)}
        restoreFocus={restoreFocus}
        preview={
          selected ? (
            <TemplateMessage
              version={selected.currentVersion}
              businessName={selected.wabaName}
              library
            />
          ) : null
        }
      >
        {selected ? (
          <>
            <TemplateStatus template={selected} />
            <div className="flex flex-wrap items-center gap-2">
              {approved.data?.some((t) => t.templateId === selected.id) &&
              can('campaigns.write') ? (
                <Button size="sm" asChild>
                  <Link
                    href={`/campaigns/new?templateVersionId=${approved.data.find((t) => t.templateId === selected.id)?.versionId}`}
                  >
                    Use in campaign
                  </Link>
                </Button>
              ) : null}
              <Button variant="secondary" size="sm" asChild>
                <Link href={`/templates/${selected.id}`}>
                  {selected.status === 'DRAFT' && can('templates.write')
                    ? 'Open editor'
                    : 'Open template'}
                </Link>
              </Button>
              {approved.data?.some((t) => t.templateId === selected.id) && can('inbox.read') ? (
                <Button variant="link" size="sm" asChild>
                  <Link href="/inbox">
                    Open Inbox
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
              ) : null}
            </div>
            {approved.isError ? (
              <ErrorState
                title="Sending options couldn’t be loaded"
                onRetry={() => void approved.refetch()}
              />
            ) : null}
            <section className="border-t border-border pt-3" aria-label="Template details">
              <h3 className="mb-2 text-sm font-semibold">Template details</h3>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-secondary">Category</dt>
                <dd>{CATEGORY_LABEL[selected.category]}</dd>
                <dt className="text-secondary">Language</dt>
                <dd>{languageLabel(selected.language)}</dd>
                <dt className="text-secondary">Quality</dt>
                <dd>{selected.qualityScore ?? 'Not available'}</dd>
                <dt className="text-secondary">Created</dt>
                <dd>{relativeTime(selected.createdAt)}</dd>
              </dl>
            </section>
            {selected.currentVersion.samples.body.length ? (
              <section className="border-t border-border pt-3" aria-label="Stored sample values">
                <h3 className="mb-2 text-sm font-semibold">Message sample values</h3>
                <p className="mb-2 text-xs text-muted">Stored examples for this version.</p>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  {selected.currentVersion.samples.body.map((sample, index) => (
                    <div key={index} className="contents">
                      <dt className="text-secondary">{`Message {{${index + 1}}}`}</dt>
                      <dd className="break-words">{sample}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ) : null}
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <dt className="text-muted">WhatsApp account</dt>
              <dd className="break-words">{selected.wabaName}</dd>
              <dt className="text-muted">Current version</dt>
              <dd>v{selected.currentVersion.version}</dd>
              <dt className="text-muted">Updated</dt>
              <dd>{relativeTime(selected.updatedAt)}</dd>
            </dl>
            {selected.status === 'PENDING' ? (
              <Alert tone="info" title="In review at Meta">
                This version can be sent after approval.
                {selected.approvedVersionId
                  ? ' The previous approved version remains available.'
                  : ''}
              </Alert>
            ) : null}
            {selected.status === 'REJECTED' ? (
              <Alert tone="danger" title="Meta rejected this version">
                {selected.currentVersion.rejectionReason ?? 'Meta did not provide a reason.'} Open
                the template to edit a new version and resubmit.
              </Alert>
            ) : null}
            {selected.status === 'PAUSED' || selected.status === 'DISABLED' ? (
              <Alert tone="warning" title="Sending unavailable">
                Meta must allow this template again before it can be sent.
              </Alert>
            ) : null}
            {selected.currentVersion.lastError ? (
              <Alert tone="warning" title="Submission needs attention">
                {selected.currentVersion.lastError}. The draft is preserved; open it to retry.
              </Alert>
            ) : null}
          </>
        ) : null}
      </TemplateContext>
    </div>
  )
}

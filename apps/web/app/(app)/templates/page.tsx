'use client'

import { TEMPLATE_CATEGORIES, type Template } from '@fenwira/contracts'
import {
  Alert,
  Button,
  Card,
  CardContent,
  DetailDrawer,
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
import { Eye, Plus, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { useRef, useState } from 'react'
import { useDebounced } from '@/components/inbox/conversation-list'
import { useSession } from '@/components/session/session-provider'
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
const VIEWS = [
  { id: ALL, label: 'All templates', statuses: [] },
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
      <SelectTrigger aria-label={label} className="h-9 w-44">
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
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <StatusBadge status={t.status} label={t.status === 'PENDING' ? 'In review' : undefined} />
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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const search = useDebounced(q.trim())
  const templates = useTemplates(
    new URLSearchParams({
      ...(search ? { q: search } : {}),
      ...(category !== ALL ? { category } : {}),
      ...(language !== ALL ? { language } : {}),
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
  const visible = statuses.length ? all.filter((t) => statuses.includes(t.status)) : all
  const selected = all.find((t) => t.id === selectedId)
  const filtered = !!(search || view !== ALL || category !== ALL || language !== ALL)
  const rejected = all.filter((t) => t.status === 'REJECTED').length
  const create = can('templates.write') ? (
    <Button asChild>
      <Link href="/templates/new">
        <Plus aria-hidden="true" />
        New template
      </Link>
    </Button>
  ) : undefined
  return (
    <ListPage
      header={{
        title: 'Templates',
        description: 'Your team’s reusable WhatsApp messages.',
        actions: can('templates.write') ? (
          <>
            <Button variant="secondary" loading={sync.isPending} onClick={() => sync.mutate()}>
              <RefreshCw aria-hidden="true" />
              Sync from Meta
            </Button>
            {create}
          </>
        ) : null,
      }}
      banner={
        rejected && view !== 'ATTENTION' ? (
          <Alert
            tone="danger"
            title={`${rejected} template${rejected > 1 ? 's were' : ' was'} rejected by Meta`}
            action={
              <Button variant="secondary" size="sm" onClick={() => setView('ATTENTION')}>
                Show rejected
              </Button>
            }
          >
            Open a template to see Meta’s reason, edit it and submit it again.
          </Alert>
        ) : undefined
      }
    >
      <Tabs value={view} onValueChange={setView}>
        <TabsList aria-label="Template views">
          {VIEWS.map((v) => (
            <TabsTrigger key={v.id} value={v.id}>
              {v.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <FilterBar
          activeCount={(search ? 1 : 0) + (category !== ALL ? 1 : 0) + (language !== ALL ? 1 : 0)}
          onClear={() => {
            setQ('')
            setCategory(ALL)
            setLanguage(ALL)
            setView(ALL)
          }}
        >
          <SearchInput
            label="Search templates"
            placeholder="Search your message library"
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
              new Set([...TEMPLATE_LANGUAGES.map((l) => l.code), ...all.map((t) => t.language)]),
            ).map((code) => ({ value: code, label: languageLabel(code) }))}
          />
        </FilterBar>
        <TabsContent value={view}>
          {templates.isPending ? (
            <div
              className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
              aria-label="Loading templates"
              aria-busy="true"
            >
              {[0, 1, 2].map((n) => (
                <Skeleton key={n} className="h-72" />
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
              action={!filtered ? create : undefined}
            />
          ) : (
            <ul aria-label="Template library" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {visible.map((t) => (
                <li key={t.id} className="min-w-0">
                  <Card className="h-full">
                    <CardContent className="flex h-full flex-col gap-4 p-4">
                      <div className="flex flex-col gap-2">
                        <Link
                          href={`/templates/${t.id}`}
                          className={cn(
                            'break-words font-semibold text-slate underline-offset-4 hover:underline',
                            focusRing,
                          )}
                        >
                          {t.name}
                        </Link>
                        <p className="text-sm text-muted">
                          {CATEGORY_LABEL[t.category]} · {languageLabel(t.language)}
                        </p>
                        <TemplateStatus template={t} />
                      </div>
                      <TemplateMessage version={t.currentVersion} compact />
                      {t.status === 'REJECTED' && t.currentVersion.rejectionReason ? (
                        <p className="line-clamp-2 text-sm text-secondary">
                          Meta: {t.currentVersion.rejectionReason}
                        </p>
                      ) : null}
                      {t.currentVersion.lastError ? (
                        <p className="line-clamp-2 text-sm text-secondary">
                          Last submission: {t.currentVersion.lastError}
                        </p>
                      ) : null}
                      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                        <span className="text-sm text-muted">
                          Updated {relativeTime(t.updatedAt)}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Preview ${t.name}`}
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
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
      <DetailDrawer
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null)
        }}
        width="md"
        title={selected?.name ?? 'Template preview'}
        description={
          selected
            ? `${CATEGORY_LABEL[selected.category]} · ${languageLabel(selected.language)}`
            : undefined
        }
        fullHref={selected ? `/templates/${selected.id}` : undefined}
        fullLabel={
          selected?.status === 'DRAFT' && can('templates.write') ? 'Open editor' : 'Open template'
        }
        linkAs={Link}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          trigger.current?.focus()
        }}
      >
        {selected ? (
          <>
            <TemplateStatus template={selected} />
            <TemplateMessage version={selected.currentVersion} />
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
            {approved.data?.some((t) => t.templateId === selected.id) && can('inbox.read') ? (
              <div className="flex flex-col gap-2 border-t border-border pt-4">
                <p className="text-sm text-secondary">
                  Choose the approved version in an existing Inbox conversation.
                </p>
                <Button variant="secondary" asChild>
                  <Link href="/inbox">Open Inbox</Link>
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
      </DetailDrawer>
    </ListPage>
  )
}

'use client'

import { type Template, type TemplateVersion } from '@fenwira/contracts'
import {
  Alert,
  Button,
  Card,
  CardContent,
  type ColumnDef,
  DataTable,
  ErrorState,
  PageHeader,
  PermissionState,
  Skeleton,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
  useConfirm,
} from '@fenwira/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from '@/components/session/session-provider'
import { TemplateBuilder } from '@/components/templates/template-builder'
import { TemplateMessage } from '@/components/templates/template-message'
import { ApiError, del, post } from '@/lib/api/client'
import { relativeTime } from '@/lib/relative-time'
import {
  CATEGORY_LABEL,
  draftOf,
  languageLabel,
  templatesKey,
  useTemplate,
  useTemplateVersions,
} from '@/lib/templates'

const when = (iso: string | null) => (iso ? relativeTime(iso) : '—')

function Versions({ id }: { id: string }) {
  const versions = useTemplateVersions(id)
  const columns: Array<ColumnDef<TemplateVersion>> = [
    { id: 'version', header: 'Version', cell: ({ row }) => `v${row.original.version}` },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: 'origin',
      header: 'Made in',
      cell: ({ row }) => (row.original.origin === 'META' ? 'WhatsApp Manager' : 'Fenwira'),
    },
    { id: 'submitted', header: 'Submitted', cell: ({ row }) => when(row.original.submittedAt) },
    { id: 'decided', header: 'Decided', cell: ({ row }) => when(row.original.decidedAt) },
    {
      id: 'reason',
      header: 'Rejection reason',
      cell: ({ row }) => row.original.rejectionReason ?? row.original.lastError ?? '—',
    },
  ]
  return (
    <DataTable
      label="Versions"
      columns={columns}
      data={versions.data ?? []}
      getRowId={(v) => v.id}
      loading={versions.isPending}
      error={versions.isError ? { onRetry: () => void versions.refetch() } : undefined}
      empty={{ title: 'No versions', description: '' }}
    />
  )
}

/** A template: its current version (editable while a draft), actions, and version history. */
export default function TemplatePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { tenantId, can } = useSession()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const template = useTemplate(id)
  const refresh = () => void queryClient.invalidateQueries({ queryKey: templatesKey(tenantId) })
  const onError = (err: unknown) =>
    toast.error(err instanceof ApiError ? err.message : 'Something went wrong.')
  const submit = useMutation({
    mutationFn: () =>
      post<{ data: Template }>(`/templates/${id}/submit`, undefined, {
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      }),
    onSuccess: () => {
      toast.success('Submitted to Meta for review')
      refresh()
    },
    onError: (err) => {
      refresh()
      onError(err)
    },
  })
  const newVersion = useMutation({
    mutationFn: () => post(`/templates/${id}/versions`),
    onSuccess: refresh,
    onError,
  })
  const remove = useMutation({
    mutationFn: () => del(`/templates/${id}`),
    onSuccess: () => {
      toast.success('Template deleted')
      refresh()
      router.replace('/templates')
    },
    onError,
  })

  if (!can('templates.read')) return <PermissionState what="templates" />
  if (template.isPending) return <Skeleton className="h-96" />
  if (template.isError || !template.data)
    return <ErrorState onRetry={() => void template.refetch()} />
  const t = template.data
  const v = t.currentVersion
  const editable = v.status === 'DRAFT' && can('templates.write')
  const canNewVersion =
    can('templates.write') && ['APPROVED', 'REJECTED', 'PAUSED'].includes(v.status)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.name}
        description={`${languageLabel(t.language)} · ${CATEGORY_LABEL[t.category]} · ${t.wabaName}`}
        breadcrumbs={[{ label: 'Templates', href: '/templates' }, { label: t.name }]}
        linkAs={Link}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={t.status} />
            {v.status === 'DRAFT' && can('templates.submit') && v.lastError ? (
              <Button loading={submit.isPending} onClick={() => submit.mutate()}>
                Retry submit
              </Button>
            ) : null}
            {canNewVersion ? (
              <Button
                variant="secondary"
                loading={newVersion.isPending}
                onClick={() => newVersion.mutate()}
              >
                Edit (new version)
              </Button>
            ) : null}
            {can('templates.write') ? (
              <Button
                variant="ghost"
                onClick={async () => {
                  if (
                    await confirm({
                      title: `Delete ${t.name}?`,
                      description: v.metaTemplateId
                        ? 'This can’t be undone.'
                        : 'This draft is removed.',
                      impact: v.metaTemplateId
                        ? [
                            'It is deleted at Meta too, in every language.',
                            'Campaigns and automations that use it can no longer send it.',
                          ]
                        : undefined,
                      confirmLabel: 'Delete template',
                      destructive: true,
                    })
                  )
                    remove.mutate()
                }}
              >
                Delete
              </Button>
            ) : null}
          </div>
        }
      />
      {v.status === 'PENDING' ? (
        <Alert tone="info" title="Meta is reviewing this template">
          This usually takes minutes, sometimes up to 24 hours. This page updates by itself.
          {t.approvedVersionId && t.approvedVersionId !== v.id
            ? ' The previously approved version stays in use until then.'
            : ''}
        </Alert>
      ) : null}
      {v.status === 'REJECTED' ? (
        <Alert
          tone="danger"
          title="Meta rejected this version"
          action={
            canNewVersion ? (
              <Button
                variant="secondary"
                size="sm"
                loading={newVersion.isPending}
                onClick={() => newVersion.mutate()}
              >
                Edit and resubmit
              </Button>
            ) : undefined
          }
        >
          <span className="font-medium">Meta’s reason:</span> {v.rejectionReason ?? 'not given'}.
          Fix the content in a new version and submit it again.
        </Alert>
      ) : null}
      {v.status === 'DRAFT' && v.lastError ? (
        <Alert tone="warning" title="The last submit didn't reach Meta">
          {v.lastError}. It is still a draft; try again.
        </Alert>
      ) : null}
      {v.status === 'PAUSED' || v.status === 'DISABLED' ? (
        <Alert
          tone="warning"
          title={`Meta ${v.status === 'PAUSED' ? 'paused' : 'disabled'} this template`}
        >
          It can't be sent until Meta allows it again. Low quality ratings are the usual cause.
        </Alert>
      ) : null}

      <Tabs defaultValue="content">
        <TabsList>
          <TabsTrigger value="content">{editable ? 'Editor' : 'Content'}</TabsTrigger>
          <TabsTrigger value="versions">Version history</TabsTrigger>
        </TabsList>
        <TabsContent value="content">
          {editable ? (
            <TemplateBuilder key={v.id} template={t} initial={draftOf(t)} onSaved={refresh} />
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardContent className="flex flex-col gap-4 p-5">
                  <h2 className="text-md font-semibold">WhatsApp message</h2>
                  <TemplateMessage version={v} businessName={t.wabaName} />
                </CardContent>
              </Card>
              <dl className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5 text-base">
                {[
                  ['Version', `v${v.version}`],
                  ['Submitted', when(v.submittedAt)],
                  ['Decided', when(v.decidedAt)],
                  ['Quality', t.qualityScore ?? 'Unknown'],
                  ['Meta template ID', v.metaTemplateId ?? '—'],
                ].map(([k, val]) => (
                  <div key={k} className="flex gap-2">
                    <dt className="w-32 shrink-0 text-muted">{k}</dt>
                    <dd className="min-w-0 break-words text-slate">{val}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </TabsContent>
        <TabsContent value="versions">
          <Versions id={id} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

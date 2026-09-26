'use client'

import { type CampaignRecipient, RECIPIENT_STATUSES } from '@fenwira/contracts'
import {
  Alert,
  Button,
  type ColumnDef,
  DataTable,
  ErrorState,
  KpiCard,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusBadge,
  toast,
  useConfirm,
} from '@fenwira/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useId, useState } from 'react'
import { CampaignWizard } from '@/components/campaigns/campaign-wizard'
import { useSession } from '@/components/session/session-provider'
import { NoAccess } from '@/components/settings/no-access'
import { ApiError, post } from '@/lib/api/client'
import {
  ACTIVE_STATUSES,
  campaignsKey,
  formatInZone,
  PAUSE_LABEL,
  percent,
  skipLabel,
  useCampaign,
  useCampaignStats,
  useRecipients,
} from '@/lib/campaigns'

const ALL = 'ALL'

function Recipients({ id, live, timezone }: { id: string; live: boolean; timezone: string }) {
  const [status, setStatus] = useState(ALL)
  const selectId = useId()
  const recipients = useRecipients(id, status === ALL ? '' : status, live)
  const rows = recipients.data?.pages.flatMap((p) => p.data) ?? []
  const columns: Array<ColumnDef<CampaignRecipient>> = [
    { id: 'contact', header: 'Contact', cell: ({ row }) => row.original.contactName ?? '—' },
    {
      id: 'phone',
      header: 'Phone',
      cell: ({ row }) => <span className="font-mono text-sm">{row.original.phoneE164}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: 'reason',
      header: 'Reason',
      cell: ({ row }) =>
        row.original.skipReason
          ? skipLabel(row.original.skipReason)
          : (row.original.errorCode ?? '—'),
    },
    {
      id: 'updated',
      header: 'Last update',
      cell: ({ row }) => {
        const r = row.original
        const at = r.readAt ?? r.deliveredAt ?? r.sentAt ?? r.failedAt ?? r.queuedAt
        return at ? formatInZone(at, timezone) : '—'
      },
    },
  ]
  return (
    <section aria-labelledby="recipients-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="recipients-heading" className="text-lg font-semibold text-slate">
          Recipients
        </h2>
        <div className="flex flex-col gap-1.5">
          <span id={selectId} className="text-sm font-medium text-slate">
            Status
          </span>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger aria-labelledby={selectId} className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All</SelectItem>
              {RECIPIENT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.charAt(0) + s.slice(1).toLowerCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <DataTable
        label="Recipients"
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        loading={recipients.isPending}
        empty={{
          title: 'No recipients here',
          description: 'Recipients appear once the audience is prepared.',
        }}
      />
      {recipients.hasNextPage ? (
        <Button
          variant="secondary"
          className="self-start"
          loading={recipients.isFetchingNextPage}
          onClick={() => void recipients.fetchNextPage()}
        >
          Load more
        </Button>
      ) : null}
    </section>
  )
}

/** Campaign detail: controls, funding state, operational stats and recipient results. */
export default function CampaignPage() {
  const { id } = useParams<{ id: string }>()
  const { tenantId, can } = useSession()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const campaign = useCampaign(id)
  const c = campaign.data
  // Delivered and read receipts keep arriving after completion: keep refreshing for an hour.
  const live = c
    ? ACTIVE_STATUSES.includes(c.status) ||
      Boolean(c.completedAt && Date.now() - new Date(c.completedAt).getTime() < 3600_000)
    : false
  const stats = useCampaignStats(id, live)
  const action = useMutation({
    mutationFn: (name: 'pause' | 'resume' | 'cancel' | 'unschedule') =>
      post(`/campaigns/${id}/${name}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: campaignsKey(tenantId) }),
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'That didn’t work.'),
  })
  const exportCsv = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/v1/campaigns/${id}/recipients/export`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'X-Tenant-Id': tenantId,
          'X-CSRF-Token': document.cookie.match(/fw_csrf=([^;]+)/)?.[1] ?? '',
        },
      })
      if (!res.ok) throw new Error('The export failed.')
      const url = URL.createObjectURL(await res.blob())
      const a = Object.assign(document.createElement('a'), {
        href: url,
        download: `campaign-${id}.csv`,
      })
      a.click()
      URL.revokeObjectURL(url)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'The export failed.'),
  })

  if (!can('campaigns.read')) return <NoAccess what="campaigns" />
  if (campaign.isPending) return <Skeleton className="h-96" />
  if (campaign.isError || !c) return <ErrorState onRetry={() => void campaign.refetch()} />
  if (c.status === 'DRAFT' && can('campaigns.write'))
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title={c.name}
          breadcrumbs={[{ label: 'Campaigns', href: '/campaigns' }, { label: c.name }]}
          linkAs={Link}
        />
        <CampaignWizard campaign={c} />
      </div>
    )
  const s = stats.data
  const control = can('campaigns.launch')
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={c.name}
        description={`${c.template?.name ?? 'No template'} · ${c.phoneNumberDisplay ?? ''}`}
        breadcrumbs={[{ label: 'Campaigns', href: '/campaigns' }, { label: c.name }]}
        linkAs={Link}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={c.status} />
            {control && (c.status === 'RUNNING' || c.status === 'PREPARING') ? (
              <Button
                variant="secondary"
                loading={action.isPending}
                onClick={() => action.mutate('pause')}
              >
                Pause
              </Button>
            ) : null}
            {control && (c.status === 'PAUSED' || c.status === 'PAUSED_INSUFFICIENT_FUNDS') ? (
              <Button loading={action.isPending} onClick={() => action.mutate('resume')}>
                Resume
              </Button>
            ) : null}
            {control && c.status === 'SCHEDULED' ? (
              <Button variant="secondary" onClick={() => action.mutate('unschedule')}>
                Unschedule
              </Button>
            ) : null}
            {control &&
            ['SCHEDULED', 'PREPARING', 'RUNNING', 'PAUSED', 'PAUSED_INSUFFICIENT_FUNDS'].includes(
              c.status,
            ) ? (
              <Button
                variant="ghost"
                onClick={async () => {
                  if (
                    await confirm({
                      title: `Cancel ${c.name}?`,
                      description:
                        'Recipients not sent yet won’t receive it. Messages already sent aren’t recalled.',
                      confirmLabel: 'Cancel campaign',
                      cancelLabel: 'Keep it',
                      destructive: true,
                    })
                  )
                    action.mutate('cancel')
                }}
              >
                Cancel campaign
              </Button>
            ) : null}
          </div>
        }
      />
      {c.status === 'PAUSED_INSUFFICIENT_FUNDS' ? (
        <Alert tone="danger" title="Paused: not enough credits">
          Add credits, then resume. Recipients already sent keep their results; the rest are
          waiting.
        </Alert>
      ) : null}
      {c.status === 'PAUSED' && c.pauseReason ? (
        <Alert tone="warning" title="Paused">
          {PAUSE_LABEL[c.pauseReason] ?? c.pauseReason}
        </Alert>
      ) : null}
      {c.status === 'FAILED' ? (
        <Alert tone="danger" title="The campaign stopped">
          {c.failureReason}
        </Alert>
      ) : null}
      {c.status === 'SCHEDULED' && c.scheduleAt ? (
        <Alert tone="info" title="Scheduled">
          Sends on {formatInZone(c.scheduleAt, c.timezone)} ({c.timezone}).
        </Alert>
      ) : null}

      {s ? (
        <>
          <section aria-label="Campaign results" className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiCard label="Total recipients" value={s.total.toLocaleString('en-IN')} />
            <KpiCard label="Eligible" value={s.eligible.toLocaleString('en-IN')} />
            <KpiCard label="Skipped" value={s.skipped.toLocaleString('en-IN')} />
            <KpiCard label="Queued" value={(s.pending + s.queued).toLocaleString('en-IN')} />
            <KpiCard label="Sent" value={s.sent.toLocaleString('en-IN')} />
            <KpiCard label="Delivered" value={s.delivered.toLocaleString('en-IN')} />
            <KpiCard label="Read" value={s.read.toLocaleString('en-IN')} />
            <KpiCard label="Failed" value={s.failed.toLocaleString('en-IN')} />
          </section>
          <dl className="flex flex-wrap gap-6 text-base text-slate">
            <div>
              <dt className="text-sm text-muted">Delivery rate</dt>
              <dd className="font-semibold">{percent(s.deliveryRate)}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Read rate</dt>
              <dd className="font-semibold">{percent(s.readRate)}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Failure rate</dt>
              <dd className="font-semibold">{percent(s.failureRate)}</dd>
            </div>
            {s.durationSeconds !== null ? (
              <div>
                <dt className="text-sm text-muted">Duration</dt>
                <dd className="font-semibold">
                  {Math.max(1, Math.round(s.durationSeconds / 60))} min
                </dd>
              </div>
            ) : null}
          </dl>
          {Object.keys(s.skipReasons).length || Object.keys(s.failureCodes).length ? (
            <div className="grid gap-4 md:grid-cols-2">
              {Object.keys(s.skipReasons).length ? (
                <section aria-labelledby="skip-heading">
                  <h2 id="skip-heading" className="mb-2 text-base font-semibold text-slate">
                    Why recipients were skipped
                  </h2>
                  <ul className="flex flex-col gap-1 text-sm text-slate">
                    {Object.entries(s.skipReasons).map(([r, n]) => (
                      <li key={r}>
                        {skipLabel(r)}: {n.toLocaleString('en-IN')}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {Object.keys(s.failureCodes).length ? (
                <section aria-labelledby="fail-heading">
                  <h2 id="fail-heading" className="mb-2 text-base font-semibold text-slate">
                    Failures
                  </h2>
                  <ul className="flex flex-col gap-1 text-sm text-slate">
                    {Object.entries(s.failureCodes).map(([code, n]) => (
                      <li key={code}>
                        <span className="font-mono">{code}</span>: {n.toLocaleString('en-IN')}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <Skeleton className="h-32" />
      )}

      {can('contacts.export') ? (
        <Button
          variant="secondary"
          className="self-start"
          loading={exportCsv.isPending}
          onClick={() => exportCsv.mutate()}
        >
          Export recipients (CSV)
        </Button>
      ) : null}
      <Recipients id={id} live={live} timezone={c.timezone} />
    </div>
  )
}

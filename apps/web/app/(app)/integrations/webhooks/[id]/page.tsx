'use client'

import { type WebhookDelivery, type WebhookEventType } from '@fenwira/contracts'
import {
  Alert,
  Badge,
  Button,
  type ColumnDef,
  Checkbox,
  DataTable,
  DetailDrawer,
  DetailPage,
  ErrorState,
  Field,
  FilterBar,
  Input,
  PermissionState,
  RowActions,
  Skeleton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusBadge,
  SummaryItem,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
  useConfirm,
} from '@fenwira/ui'
import { Eye } from 'lucide-react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useState } from 'react'
import { FormError } from '@/components/auth/form-error'
import { useSession } from '@/components/session/session-provider'
import { relativeTime } from '@/lib/relative-time'
import {
  ALL_WEBHOOK_EVENTS,
  eventFamiliesLabel,
  eventLabel,
  useDeleteWebhookEndpoint,
  useRetryWebhookDelivery,
  useRotateWebhookSecret,
  useTestWebhookDelivery,
  useUpdateWebhookEndpoint,
  useWebhookDelivery,
  useWebhookDeliveries,
  useWebhookEndpoint,
  WEBHOOK_EVENT_LABEL,
} from '@/lib/webhooks'

/** Friendly explanation instead of a raw error code (docs/WEBHOOKS.md → Observability). */
function deliverySummary(d: WebhookDelivery): string {
  if (d.status === 'SUCCEEDED') return `Delivered successfully (HTTP ${d.responseStatus}).`
  if (d.status === 'PENDING' && d.nextAttemptAt)
    return `Retry ${d.attempt} scheduled ${relativeTime(d.nextAttemptAt)}.`
  if (d.status === 'FAILED' && d.responseStatus)
    return `HTTP ${d.responseStatus} returned by the endpoint.`
  if (d.status === 'FAILED')
    return d.errorCode ? `Delivery failed: ${d.errorCode}.` : 'Delivery failed.'
  return 'Delivery is pending.'
}

function DeliveryDrawer({
  endpointId,
  deliveryId,
  onClose,
}: {
  endpointId: string
  deliveryId: string | null
  onClose: () => void
}) {
  const { data } = useWebhookDelivery(endpointId, deliveryId ?? undefined)
  const retry = useRetryWebhookDelivery(endpointId)
  return (
    <DetailDrawer
      open={!!deliveryId}
      onOpenChange={(open) => !open && onClose()}
      title={data ? eventLabel(data.eventType) : 'Delivery'}
      description={data ? `Delivery ${data.id}` : undefined}
      footer={
        data?.status === 'FAILED' ? (
          <Button
            loading={retry.isPending}
            onClick={() =>
              retry.mutate(data.id, {
                onSuccess: () => toast.success('Retry queued'),
                onError: () => toast.error('Could not queue a retry.'),
              })
            }
          >
            Retry delivery
          </Button>
        ) : undefined
      }
    >
      {data ? (
        <div className="flex flex-col gap-5">
          <Alert
            tone={
              data.status === 'SUCCEEDED' ? 'success' : data.status === 'FAILED' ? 'danger' : 'info'
            }
          >
            {deliverySummary(data as WebhookDelivery)}
          </Alert>
          <dl className="grid grid-cols-2 gap-4">
            <SummaryItem label="Event id">
              <span className="font-mono text-sm">{data.eventId}</span>
            </SummaryItem>
            <SummaryItem label="Delivery id">
              <span className="font-mono text-sm">{data.id}</span>
            </SummaryItem>
            <SummaryItem label="Event type">{data.eventType}</SummaryItem>
            <SummaryItem label="Timestamp">
              <time dateTime={data.createdAt}>{new Date(data.createdAt).toLocaleString()}</time>
            </SummaryItem>
            <SummaryItem label="Attempt">{data.attempt}</SummaryItem>
            <SummaryItem label="Response status">{data.responseStatus ?? '—'}</SummaryItem>
            <SummaryItem label="Duration">
              {data.durationMs != null ? `${data.durationMs} ms` : '—'}
            </SummaryItem>
            <SummaryItem label="Next retry">
              {data.nextAttemptAt ? relativeTime(data.nextAttemptAt) : '—'}
            </SummaryItem>
          </dl>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-slate">Request payload</p>
            <pre className="overflow-x-auto rounded-md border border-border bg-background p-3 text-sm text-slate">
              {JSON.stringify(data.payload, null, 2)}
            </pre>
          </div>
          {data.responseBody ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-slate">Response body</p>
              <pre className="max-h-48 overflow-auto rounded-md border border-border bg-background p-3 text-sm text-slate">
                {data.responseBody}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </DetailDrawer>
  )
}

export default function WebhookEndpointDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { can } = useSession()
  const endpoint = useWebhookEndpoint(id)
  const [statusFilter, setStatusFilter] = useState<'PENDING' | 'SUCCEEDED' | 'FAILED' | 'all'>(
    'all',
  )
  const deliveries = useWebhookDeliveries(id, {
    status: statusFilter === 'all' ? undefined : statusFilter,
  })
  const [openDelivery, setOpenDelivery] = useState<string | null>(null)
  const test = useTestWebhookDelivery(id)
  const rotate = useRotateWebhookSecret()
  const update = useUpdateWebhookEndpoint()
  const remove = useDeleteWebhookEndpoint()
  const confirm = useConfirm()
  const [rotatedSecret, setRotatedSecret] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editUrl, setEditUrl] = useState('')
  const [editEvents, setEditEvents] = useState<Set<WebhookEventType>>(new Set())
  const [editing, setEditing] = useState(false)

  if (!can('integrations.manage'))
    return <PermissionState what="webhooks" permission="integrations.manage" />
  if (endpoint.isLoading) return <Skeleton className="h-48" />
  if (!endpoint.data)
    return (
      <ErrorState
        title="Endpoint not found"
        description="It may have been deleted. Go back to Webhooks and pick another endpoint."
      />
    )

  const e = endpoint.data
  const lastSuccess = deliveries.data?.find((d) => d.status === 'SUCCEEDED')
  const recentFailure = deliveries.data?.find((d) => d.status === 'FAILED')

  const startEdit = () => {
    setEditName(e.name)
    setEditUrl(e.url)
    setEditEvents(new Set(e.events))
    setEditing(true)
  }

  const deliveryColumns: ColumnDef<WebhookDelivery, unknown>[] = [
    {
      accessorKey: 'createdAt',
      header: 'Time',
      cell: ({ row }) => relativeTime(row.original.createdAt),
    },
    {
      accessorKey: 'eventType',
      header: 'Event',
      cell: ({ row }) =>
        row.original.eventType === 'webhook.test' ? (
          <span className="flex items-center gap-1.5">
            Test delivery
            <Badge tone="info">Test</Badge>
          </span>
        ) : (
          eventLabel(row.original.eventType)
        ),
    },
    {
      id: 'result',
      header: 'HTTP result',
      cell: ({ row }) => row.original.responseStatus ?? '—',
    },
    { accessorKey: 'attempt', header: 'Attempt' },
    {
      id: 'duration',
      header: 'Duration',
      cell: ({ row }) => (row.original.durationMs != null ? `${row.original.durationMs} ms` : '—'),
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      enableHiding: false,
      enableSorting: false,
      cell: ({ row }) => (
        <RowActions
          label={`Actions for this delivery`}
          actions={[
            {
              label: 'View details',
              icon: <Eye aria-hidden="true" />,
              onSelect: () => setOpenDelivery(row.original.id),
            },
          ]}
        />
      ),
    },
  ]

  return (
    <DetailPage
      header={{
        title: e.name,
        description: e.url,
        breadcrumbs: [{ label: 'Webhooks', href: '/integrations/webhooks' }, { label: e.name }],
        linkAs: Link,
        actions: (
          <Button
            variant="secondary"
            loading={test.isPending}
            onClick={() =>
              test.mutate(undefined, {
                onSuccess: () => toast.success('Test delivery sent'),
                onError: () => toast.error('Could not send a test delivery.'),
              })
            }
          >
            Send test
          </Button>
        ),
      }}
      banner={
        e.status === 'DISABLED' ? (
          <Alert tone="danger" title="This endpoint was automatically disabled">
            <div className="flex flex-col gap-1">
              <p>
                It was disabled after too many consecutive failed deliveries
                {recentFailure ? ` (last failure ${relativeTime(recentFailure.createdAt)})` : ''}.
              </p>
              <p>
                {lastSuccess
                  ? `Last successful delivery ${relativeTime(lastSuccess.createdAt)}.`
                  : 'There is no successful delivery on record.'}
              </p>
              <p>
                Check that the endpoint URL is reachable and returning a 2xx response, then send a
                test delivery and re-enable the endpoint from Settings.
              </p>
            </div>
          </Alert>
        ) : null
      }
      summary={
        <>
          <SummaryItem label="Status">
            <StatusBadge status={e.status} />
          </SummaryItem>
          <SummaryItem label="Subscribed events">{eventFamiliesLabel(e.events)}</SummaryItem>
          <SummaryItem label="Signing">Configured</SummaryItem>
          <SummaryItem label="Last successful delivery">
            {lastSuccess ? relativeTime(lastSuccess.createdAt) : 'None yet'}
          </SummaryItem>
        </>
      }
    >
      <Tabs defaultValue="overview">
        <TabsList aria-label="Webhook endpoint sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="deliveries">Deliveries</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex flex-col gap-4">
          <div className="rounded-lg border border-border bg-surface p-5">
            <p className="mb-3 text-sm font-semibold text-slate">Subscribed event families</p>
            <div className="flex flex-wrap gap-1.5">
              {e.events.map((ev) => (
                <Badge key={ev} tone="neutral">
                  {eventLabel(ev)}
                </Badge>
              ))}
            </div>
          </div>
          {recentFailure && e.status === 'ACTIVE' ? (
            <Alert tone="warning" title="Delivery failed">
              {deliverySummary(recentFailure)}
            </Alert>
          ) : null}
        </TabsContent>

        <TabsContent value="deliveries" className="flex flex-col gap-4">
          <FilterBar>
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="SUCCEEDED">Succeeded</SelectItem>
                <SelectItem value="FAILED">Failed</SelectItem>
              </SelectContent>
            </Select>
          </FilterBar>
          <DataTable
            label="Deliveries"
            columns={deliveryColumns}
            data={deliveries.data ?? []}
            getRowId={(d) => d.id}
            loading={deliveries.isLoading}
            empty={{
              title: 'No deliveries yet',
              description: 'Deliveries appear here once an event fires or you send a test.',
            }}
          />
        </TabsContent>

        <TabsContent value="settings" className="flex max-w-xl flex-col gap-5">
          {editing ? (
            <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
              <FormError error={update.error} />
              <Field label="Name">
                <Input value={editName} onChange={(ev) => setEditName(ev.target.value)} />
              </Field>
              <Field label="Endpoint URL">
                <Input value={editUrl} onChange={(ev) => setEditUrl(ev.target.value)} />
              </Field>
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium text-slate">Events</legend>
                <div className="flex flex-col gap-2 rounded-md border border-border p-3">
                  {ALL_WEBHOOK_EVENTS.map((ev) => (
                    <label key={ev} className="flex items-center gap-2.5 text-base text-slate">
                      <Checkbox
                        checked={editEvents.has(ev)}
                        onCheckedChange={(checked) =>
                          setEditEvents((prev) => {
                            const n = new Set(prev)
                            if (checked) n.add(ev)
                            else n.delete(ev)
                            return n
                          })
                        }
                      />
                      {WEBHOOK_EVENT_LABEL[ev]}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <Button
                  loading={update.isPending}
                  onClick={() =>
                    update.mutate(
                      {
                        id: e.id,
                        name: editName.trim(),
                        url: editUrl.trim(),
                        events: [...editEvents],
                      },
                      {
                        onSuccess: () => {
                          toast.success('Endpoint updated')
                          setEditing(false)
                        },
                      },
                    )
                  }
                >
                  Save changes
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface p-5">
              <div>
                <p className="font-semibold text-slate">Endpoint details</p>
                <p className="text-sm text-muted">Name, URL and subscribed events.</p>
              </div>
              <Button variant="secondary" onClick={startEdit}>
                Edit
              </Button>
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg border border-border bg-surface p-5">
            <div>
              <p className="font-semibold text-slate">
                {e.status === 'ACTIVE' ? 'Disable endpoint' : 'Re-enable endpoint'}
              </p>
              <p className="text-sm text-muted">
                {e.status === 'ACTIVE'
                  ? 'Stop sending deliveries without deleting the endpoint.'
                  : 'Resume deliveries. Send a test first to confirm the endpoint is ready.'}
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={() =>
                update.mutate(
                  { id: e.id, status: e.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' },
                  {
                    onSuccess: () =>
                      toast.success(
                        e.status === 'ACTIVE' ? 'Endpoint disabled' : 'Endpoint re-enabled',
                      ),
                  },
                )
              }
            >
              {e.status === 'ACTIVE' ? 'Disable' : 'Re-enable'}
            </Button>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border bg-surface p-5">
            <div>
              <p className="font-semibold text-slate">Signing secret</p>
              <p className="text-sm text-muted">
                Rotating generates a new secret immediately. The old secret stops verifying — there
                is no overlap window, so update your receiver first if you can.
              </p>
            </div>
            <Button
              variant="secondary"
              loading={rotate.isPending}
              onClick={async () => {
                const ok = await confirm({
                  title: 'Rotate signing secret?',
                  destructive: true,
                  impact: [
                    'The current secret stops verifying signatures immediately.',
                    'There is no grace period — update your receiver with the new secret right away.',
                  ],
                  confirmLabel: 'Rotate secret',
                })
                if (!ok) return
                rotate.mutate(e.id, { onSuccess: (d) => setRotatedSecret(d.secret) })
              }}
            >
              Rotate secret
            </Button>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-danger/30 bg-danger-soft p-5">
            <div>
              <p className="font-semibold text-slate">Delete endpoint</p>
              <p className="text-sm text-muted">Stops all deliveries. This cannot be undone.</p>
            </div>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={async () => {
                const ok = await confirm({
                  title: `Delete "${e.name}"?`,
                  destructive: true,
                  impact: [
                    'Deliveries to this endpoint stop immediately.',
                    'This cannot be undone.',
                  ],
                  confirmLabel: 'Delete endpoint',
                })
                if (!ok) return
                remove.mutate(e.id, {
                  onSuccess: () => {
                    toast.success('Endpoint deleted')
                    router.push('/integrations/webhooks')
                  },
                })
              }}
            >
              Delete
            </Button>
          </div>
        </TabsContent>
      </Tabs>

      {rotatedSecret ? (
        <DetailDrawer
          open
          onOpenChange={(open) => !open && setRotatedSecret(null)}
          title="New signing secret"
        >
          <p className="text-base font-medium text-danger-strong">
            Copy this secret now. Fenwira will not show it again.
          </p>
          <div className="mt-3 flex items-center gap-2 rounded-md border border-border bg-background p-3">
            <code className="min-w-0 flex-1 overflow-x-auto font-mono text-sm text-slate">
              {rotatedSecret}
            </code>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(rotatedSecret)
                  toast.success('Secret copied')
                } catch {
                  toast.error("Couldn't copy — select and copy the secret manually.")
                }
              }}
            >
              Copy secret
            </Button>
          </div>
        </DetailDrawer>
      ) : null}

      <DeliveryDrawer
        endpointId={e.id}
        deliveryId={openDelivery}
        onClose={() => setOpenDelivery(null)}
      />
    </DetailPage>
  )
}

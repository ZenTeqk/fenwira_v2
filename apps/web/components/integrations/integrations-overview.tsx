'use client'

import { NativeConnectors } from './native-connectors'
import { type WhatsAppConnection } from '@fenwira/contracts'
import {
  Alert,
  Button,
  Card,
  type ColumnDef,
  DataTable,
  EmptyState,
  ErrorState,
  ListPage,
  PermissionState,
  Skeleton,
  StatusBadge,
  toast,
} from '@fenwira/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Code2, MessageCircle, RefreshCw, Settings2, Webhook } from 'lucide-react'
import Link from 'next/link'
import { IntegrationLogo } from '@/components/integrations/integration-logo'
import { useSession } from '@/components/session/session-provider'
import { ApiError, get, post } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { useApiEntitled, useApiKeys } from '@/lib/api-keys'
import { relativeTime } from '@/lib/relative-time'
import { useWebhookEndpoints, useWebhooksEntitled } from '@/lib/webhooks'
import { type WebhookEndpoint } from '@fenwira/contracts'

/** Read-focused overview; setup and credential management stay in the existing screens. */
export function IntegrationsOverview() {
  const { tenantId, can, me } = useSession()
  const cache = useQueryClient()
  const canRead = can('whatsapp.read')
  const canManage = can('integrations.manage')
  const connectionsKey = keys.tenant(tenantId, 'whatsapp-connections')
  const connections = useQuery({
    queryKey: connectionsKey,
    queryFn: () => get<{ data: WhatsAppConnection[] }>('/whatsapp/connections').then((r) => r.data),
    enabled: canRead,
  })
  const apiKeys = useApiKeys()
  const apiEntitled = useApiEntitled()
  const endpoints = useWebhookEndpoints()
  const webhooksEntitled = useWebhooksEntitled()
  const sync = useMutation({
    mutationFn: (id: string) => post(`/whatsapp/connections/${id}/sync`),
    onSuccess: () => toast.success('Synced with Meta'),
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Sync failed. Try again.'),
    onSettled: () => void cache.invalidateQueries({ queryKey: connectionsKey }),
  })
  if (!canRead && !canManage) return <PermissionState what="integrations" />
  const activeKeys = apiKeys.data?.filter(
    (k) => !k.revokedAt && (!k.expiresAt || Date.parse(k.expiresAt) > Date.now()),
  ).length
  return (
    <ListPage
      header={{
        title: 'Integrations',
        description: 'Connect Fenwira with WhatsApp and your business systems.',
      }}
      className="gap-4"
    >
      {canRead ? (
        <section aria-label="WhatsApp connections" className="flex flex-col gap-3">
          {connections.isPending ? (
            <div aria-label="Loading connections" role="status">
              <Skeleton className="h-32" />
            </div>
          ) : connections.isError ? (
            <Card>
              <ErrorState onRetry={() => void connections.refetch()} />
            </Card>
          ) : !connections.data?.length ? (
            <Card>
              <EmptyState
                icon={<MessageCircle aria-hidden="true" />}
                title="No WhatsApp number connected"
                description={
                  me.features.managedLaunch
                    ? 'Contact Fenwira support to connect your business number.'
                    : 'Connect your business number to communicate with customers.'
                }
                action={
                  <Button variant="secondary" asChild>
                    <Link href="/integrations/whatsapp">
                      {me.features.managedLaunch ? 'View WhatsApp status' : 'Set up WhatsApp'}
                    </Link>
                  </Button>
                }
              />
            </Card>
          ) : (
            connections.data.map((c) => (
              <Card key={c.id} className="flex flex-wrap items-center gap-4 p-4">
                <div className="flex min-w-0 flex-1 basis-48 items-center gap-3">
                  <IntegrationLogo integration="WHATSAPP" size="lg" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold">WhatsApp</h2>
                      <StatusBadge status={c.status} />
                    </div>
                    <p className="break-words text-sm font-medium">
                      {c.label || c.verifiedName || c.waba.name}
                    </p>
                    <p className="text-sm text-secondary">Business account</p>
                  </div>
                </div>
                <dl className="grid min-w-0 flex-1 basis-80 grid-cols-2 gap-4 lg:grid-cols-4">
                  <div>
                    <dt className="text-xs text-secondary">Phone number</dt>
                    <dd className="mt-2 text-sm font-medium">{c.displayPhoneNumber}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-secondary">Quality</dt>
                    <dd className="mt-2">
                      <StatusBadge status={c.qualityRating} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-secondary">Meta webhook</dt>
                    <dd className="mt-2">
                      {c.webhookStatus === 'ACTIVE' || c.webhookStatus === 'FAILED' ? (
                        <StatusBadge
                          status={c.webhookStatus}
                          label={c.webhookStatus === 'ACTIVE' ? 'Subscribed' : 'Failed'}
                        />
                      ) : (
                        <span className="text-sm text-secondary">Not subscribed</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-secondary">Last sync</dt>
                    <dd className="mt-2 text-sm">
                      {c.lastSyncedAt ? (
                        <time dateTime={c.lastSyncedAt}>{relativeTime(c.lastSyncedAt)}</time>
                      ) : (
                        'Never'
                      )}
                    </dd>
                  </div>
                </dl>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" asChild>
                    <Link href="/integrations/whatsapp">
                      <Settings2 aria-hidden="true" />
                      {can('whatsapp.manage') ? 'Manage' : 'View connection'}
                    </Link>
                  </Button>
                  {can('whatsapp.manage') ? (
                    <Button
                      loading={sync.isPending && sync.variables === c.id}
                      disabled={sync.isPending}
                      onClick={() => sync.mutate(c.id)}
                    >
                      <RefreshCw aria-hidden="true" />
                      Sync now
                    </Button>
                  ) : null}
                </div>
                {c.credential?.status === 'INVALID' ||
                c.credential?.status === 'EXPIRING' ||
                c.steps.some((s) => s.status === 'FAILED') ? (
                  <Alert className="w-full" tone="warning" title="Connection needs attention">
                    Open Manage to review setup and access-token details.
                  </Alert>
                ) : null}
              </Card>
            ))
          )}
        </section>
      ) : null}
      {canManage ? (
        <>
          <section aria-labelledby="build-heading" className="flex flex-col gap-3">
            <div>
              <h2 id="build-heading" className="text-md font-semibold text-slate">
                Build with Fenwira
              </h2>
              <p className="text-sm text-secondary">
                Connect your applications and automate your workflows.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Card className="flex flex-col gap-3 p-4">
                <div className="flex items-center gap-4">
                  <span
                    aria-hidden="true"
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-strong"
                  >
                    <Code2 className="size-4" />
                  </span>
                  <div>
                    <h3 className="text-md font-semibold">API</h3>
                    <p className="text-sm text-secondary">Connect your applications to Fenwira.</p>
                  </div>
                </div>
                {apiKeys.isError ? (
                  <ErrorState
                    description="API key summary couldn’t load."
                    onRetry={() => void apiKeys.refetch()}
                  />
                ) : apiKeys.isPending ? (
                  <Skeleton aria-label="Loading API key summary" className="h-10" />
                ) : (
                  <div className="flex flex-wrap items-end justify-between gap-3 border-t border-border pt-3">
                    <div>
                      <p className="text-lg font-semibold tabular-nums">{activeKeys}</p>
                      <p className="text-sm text-secondary">active keys</p>
                    </div>
                    <Button variant="link" asChild>
                      <Link href="/integrations/api">Manage API keys →</Link>
                    </Button>
                  </div>
                )}
                {apiEntitled.data === false ? (
                  <Alert tone="warning" title="API access is suspended by your plan">
                    Your existing keys are retained.
                  </Alert>
                ) : null}
              </Card>
              <Card className="flex flex-col gap-3 p-4">
                <div className="flex items-center gap-4">
                  <span
                    aria-hidden="true"
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-info-soft text-info-strong"
                  >
                    <Webhook className="size-4" />
                  </span>
                  <div>
                    <h3 className="text-md font-semibold">Webhooks</h3>
                    <p className="text-sm text-secondary">
                      Receive Fenwira events in your systems.
                    </p>
                  </div>
                </div>
                {endpoints.isError ? (
                  <ErrorState
                    description="Webhook summary couldn’t load."
                    onRetry={() => void endpoints.refetch()}
                  />
                ) : endpoints.isPending ? (
                  <Skeleton aria-label="Loading webhook summary" className="h-10" />
                ) : (
                  <div className="flex flex-wrap items-end justify-between gap-3 border-t border-border pt-3">
                    <div>
                      <p className="text-lg font-semibold tabular-nums">{endpoints.data?.length}</p>
                      <p className="text-sm text-secondary">
                        endpoints · {endpoints.data?.filter((e) => e.status === 'ACTIVE').length}{' '}
                        active
                      </p>
                    </div>
                    <Button variant="link" asChild>
                      <Link href="/integrations/webhooks">Manage webhooks →</Link>
                    </Button>
                  </div>
                )}
                {webhooksEntitled.data === false ? (
                  <Alert tone="warning" title="Webhook delivery is suspended by your plan">
                    Your existing endpoints are retained.
                  </Alert>
                ) : null}
              </Card>
            </div>
          </section>
          <NativeConnectors />
          <section aria-labelledby="endpoints-heading" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 id="endpoints-heading" className="text-md font-semibold text-slate">
                  Webhook endpoints
                </h2>
                <p className="text-sm text-secondary">
                  Configured destinations and consecutive delivery failures.
                </p>
              </div>
              <Button variant="link" asChild>
                <Link href="/integrations/webhooks">Manage webhooks →</Link>
              </Button>
            </div>
            <DataTable
              label="Webhook endpoints"
              columns={columns}
              data={endpoints.data ?? []}
              getRowId={(e) => e.id}
              loading={endpoints.isPending}
              error={endpoints.isError ? { onRetry: () => void endpoints.refetch() } : undefined}
              empty={{
                title: 'No webhook endpoints yet',
                description: 'Add a destination to receive workspace events.',
              }}
            />
          </section>
        </>
      ) : null}
    </ListPage>
  )
}

const columns: Array<ColumnDef<WebhookEndpoint>> = [
  {
    id: 'name',
    header: 'Name',
    cell: ({ row }) => (
      <Link
        className="font-medium hover:underline"
        href={`/integrations/webhooks/${row.original.id}`}
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    id: 'url',
    header: 'Destination',
    cell: ({ row }) => {
      let destination = 'Destination unavailable'
      try {
        const u = new URL(row.original.url)
        destination = u.origin + u.pathname
      } catch {
        /* Invalid historic destinations remain manageable. */
      }
      return <span className="break-all text-sm text-secondary">{destination}</span>
    },
  },
  {
    id: 'status',
    header: 'Status',
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    id: 'events',
    header: 'Events',
    meta: { align: 'right' },
    cell: ({ row }) => row.original.events.length,
  },
  {
    id: 'failures',
    header: 'Consecutive failures',
    meta: { align: 'right' },
    cell: ({ row }) => row.original.failureCount,
  },
  {
    id: 'manage',
    header: 'Actions',
    cell: ({ row }) => (
      <Button variant="link" size="sm" asChild>
        <Link
          href={`/integrations/webhooks/${row.original.id}`}
          aria-label={`Manage ${row.original.name}`}
        >
          Manage
        </Link>
      </Button>
    ),
  },
]

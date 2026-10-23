'use client'
import { platformOverviewSchema, platformWorkspaceActivitySchema } from '@fenwira/contracts'
import {
  Alert,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  ListPage,
  MetricCard,
  Skeleton,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TrendChart,
} from '@fenwira/ui'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { formatMoney } from '@/lib/billing'
import { platformRequest } from '@/lib/platform'

const STATUS_LABEL: Record<string, string> = {
  TRIALING: 'Trial',
  ACTIVE: 'Active',
  PAST_DUE: 'Past due',
  SUSPENDED: 'Suspended',
  EXPIRED: 'Trial ended',
  CANCELLED: 'Cancelled',
  NONE: 'No subscription',
}
const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

/** Docs pointer shown in each page's helper text. */
export const DOCS = (section: string) => `See docs/MANAGED_LAUNCH.md § ${section}.`

/** The operator's start page: what needs attention, then the health of the business. */
export function PlatformOverview() {
  const q = useQuery({
    queryKey: ['platform', 'overview'],
    retry: false,
    queryFn: async () => platformOverviewSchema.parse(await platformRequest('/overview')),
  })
  return (
    <ListPage
      header={{
        title: 'Overview',
        description: `What needs your attention first, then workspaces, revenue, WhatsApp health and delivery. ${DOCS('3 Onboard one customer and § 4 Billing operations')}`,
      }}
    >
      {q.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : (
        <OverviewBody o={q.data} />
      )}
    </ListPage>
  )
}

function OverviewBody({ o }: { o: ReturnType<typeof platformOverviewSchema.parse> }) {
  const mrr = o.mrr.find((m) => m.currency === 'INR')
  const sent30 = o.messagesByDay.reduce((n, d) => n + d.outbound, 0)
  const statusOrder = [
    'TRIALING',
    'ACTIVE',
    'PAST_DUE',
    'SUSPENDED',
    'EXPIRED',
    'CANCELLED',
    'NONE',
  ]
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle as="h2">Needs attention</CardTitle>
        </CardHeader>
        <CardContent>
          {o.attention.length === 0 ? (
            <p className="text-sm text-secondary">Nothing needs attention right now.</p>
          ) : (
            <ul className="flex flex-col gap-2" aria-label="Needs attention">
              {o.attention.map((a, i) => (
                <li key={`${a.kind}-${i}`}>
                  <Link className="text-primary-strong hover:underline" href={a.href}>
                    {a.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="MRR"
          value={mrr ? formatMoney(mrr.amountMinor, 'INR') : '₹0'}
          hint={`${mrr?.workspaces ?? 0} paying workspace${mrr?.workspaces === 1 ? '' : 's'}, before GST`}
        />
        <MetricCard
          label="Pending payments"
          value={String(o.pendingPayments)}
          hint={`${o.overdueWorkspaces} overdue or suspended`}
        />
        <MetricCard
          label="Messages sent (30 days)"
          value={sent30.toLocaleString('en-IN')}
          hint={`${o.failedSends7d} failed in 7 days · queue ${o.queueBacklog.waiting + o.queueBacklog.delayed} waiting`}
        />
        <MetricCard
          label="Access requests (7 days)"
          value={String(o.accessRequests.new7d)}
          hint={`${o.accessRequests.unsent} not emailed · ${o.emailFailures7d} email failures`}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle as="h2">Workspaces by status</CardTitle>
          </CardHeader>
          <CardContent>
            <TrendChart
              label="Workspaces by status"
              variant="bar"
              pointHeader="Status"
              data={statusOrder
                .filter((s) => o.statusCounts[s])
                .map((s) => ({ label: STATUS_LABEL[s] ?? s, values: { n: o.statusCounts[s]! } }))}
              series={[{ key: 'n', label: 'Workspaces', tone: 'primary' }]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle as="h2">New workspaces per month</CardTitle>
          </CardHeader>
          <CardContent>
            <TrendChart
              label="New workspaces per month"
              variant="bar"
              pointHeader="Month"
              data={o.newWorkspaces.map((m) => ({ label: m.month, values: { n: m.count } }))}
              series={[{ key: 'n', label: 'New workspaces', tone: 'info' }]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle as="h2">Revenue by month (paid, INR)</CardTitle>
          </CardHeader>
          <CardContent>
            <TrendChart
              label="Revenue by month"
              variant="bar"
              pointHeader="Month"
              formatValue={(v) => formatMoney(v, 'INR')}
              data={[...o.revenueByMonth]
                .filter((r) => r.currency === 'INR')
                .reverse()
                .map((r) => ({ label: r.month, values: { total: r.totalMinor } }))}
              series={[{ key: 'total', label: 'Paid', tone: 'success' }]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle as="h2">Messages per day (30 days)</CardTitle>
          </CardHeader>
          <CardContent>
            <TrendChart
              label="Messages per day"
              variant="line"
              pointHeader="Day"
              data={o.messagesByDay.map((d) => ({
                label: d.day.slice(5),
                values: { inbound: d.inbound, outbound: d.outbound },
              }))}
              series={[
                { key: 'outbound', label: 'Sent', tone: 'primary' },
                { key: 'inbound', label: 'Received', tone: 'info' },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Trials ending in the next 7 days</CardTitle>
        </CardHeader>
        <CardContent>
          {o.trialsEnding.length === 0 ? (
            <p className="text-sm text-secondary">No trials end this week.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {o.trialsEnding.map((t) => (
                <li key={t.workspaceId}>
                  <Link
                    className="text-primary-strong hover:underline"
                    href={`/platform/workspaces/${t.workspaceId}`}
                  >
                    {t.name}
                  </Link>{' '}
                  <span className="text-sm text-secondary">· ends {day(t.trialEndsAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">WhatsApp connection health</CardTitle>
        </CardHeader>
        <CardContent>
          {o.connections.length === 0 ? (
            <EmptyState title="No WhatsApp numbers connected yet" />
          ) : (
            <Table containerLabel="WhatsApp connection health">
              <TableHeader>
                <TableRow>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Number</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Quality</TableHead>
                  <TableHead>Messaging limit</TableHead>
                  <TableHead>Webhook</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {o.connections.map((c) => (
                  <TableRow key={`${c.workspaceId}-${c.number}`}>
                    <TableCell>
                      <Link
                        className="text-primary-strong hover:underline"
                        href={`/platform/workspaces/${c.workspaceId}`}
                      >
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell>{c.number}</TableCell>
                    <TableCell>
                      <StatusBadge
                        status={c.status === 'CONNECTED' ? 'HEALTHY' : 'ATTENTION'}
                        label={c.status.toLowerCase()}
                      />
                    </TableCell>
                    <TableCell>{c.quality.toLowerCase()}</TableCell>
                    <TableCell>{c.messagingLimit ?? '—'}</TableCell>
                    <TableCell>
                      {c.webhook ? c.webhook.toLowerCase() : '—'}
                      {c.lastWebhookAt ? ` · last ${day(c.lastWebhookAt)}` : ''}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {o.queueBacklog.failed ? (
        <Alert tone="warning" title="Failed background jobs">
          {o.queueBacklog.failed} job{o.queueBacklog.failed === 1 ? '' : 's'} failed in the queues.
          Check the worker logs (docs/runbooks).
        </Alert>
      ) : null}
    </div>
  )
}

/** Workspace detail: 30-day message volume and the latest audit actions (no message content). */
export function WorkspaceActivity({ workspaceId }: { workspaceId: string }) {
  const q = useQuery({
    queryKey: ['platform', 'workspace-activity', workspaceId],
    retry: false,
    queryFn: async () =>
      platformWorkspaceActivitySchema.parse(
        await platformRequest(`/workspaces/${workspaceId}/activity`),
      ),
  })
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle as="h2">Messages (30 days)</CardTitle>
        </CardHeader>
        <CardContent>
          {q.isPending ? (
            <Skeleton className="h-40 w-full" />
          ) : q.isError ? (
            <ErrorState onRetry={() => void q.refetch()} />
          ) : (
            <TrendChart
              label="Workspace messages per day"
              variant="line"
              pointHeader="Day"
              data={q.data.messagesByDay.map((d) => ({
                label: d.day.slice(5),
                values: { inbound: d.inbound, outbound: d.outbound },
              }))}
              series={[
                { key: 'outbound', label: 'Sent', tone: 'primary' },
                { key: 'inbound', label: 'Received', tone: 'info' },
              ]}
            />
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle as="h2">Recent activity</CardTitle>
        </CardHeader>
        <CardContent>
          {q.isPending ? (
            <Skeleton className="h-40 w-full" />
          ) : q.isError ? null : q.data.recentAudit.length === 0 ? (
            <p className="text-sm text-secondary">No audit entries yet.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm" aria-label="Recent audit entries">
              {q.data.recentAudit.map((a, i) => (
                <li key={i}>
                  <span className="text-secondary">{new Date(a.createdAt).toLocaleString()}</span> ·{' '}
                  {a.action.replaceAll('_', ' ')}{' '}
                  <span className="text-muted">({a.actorType.toLowerCase()})</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

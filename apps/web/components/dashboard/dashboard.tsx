'use client'

import {
  type Campaign,
  type Conversation,
  type OverviewAnalytics,
  type QualityRating,
  type Template,
} from '@fenwira/contracts'
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConnectionState,
  DashboardLayout,
  MetricCard,
  ErrorState,
  Skeleton,
  StatusBadge,
  type StatusKey,
} from '@fenwira/ui'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  CircleCheck,
  CircleAlert,
  HeartPulse,
  MessageSquare,
  Send,
  Wallet,
} from 'lucide-react'
import Link from 'next/link'
import { AutomationActivity, CampaignActivity, RecentConversations } from './home-activity'
import { useSession } from '@/components/session/session-provider'
import { get } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { type ApiHealthView } from '@/lib/health'
import { countDelta, percent, rateDelta, useAnalytics } from '@/lib/analytics'
import { useWallet } from '@/lib/billing'
import {
  connectionSummary,
  formatMoney,
  useConnections,
  useWorkspaceStatus,
} from '@/lib/workspace-status'

type Attention = {
  id: string
  tone: 'danger' | 'warning' | 'info'
  title: string
  body: string
  href: string
  action: string
}

const MAX = 100
const count = (n: number | undefined) =>
  n === undefined ? undefined : n >= MAX ? `${MAX}+` : n.toLocaleString('en-IN')

const QUALITY: Record<QualityRating, { status: StatusKey; label: string }> = {
  GREEN: { status: 'GREEN', label: 'High' },
  YELLOW: { status: 'YELLOW', label: 'Medium' },
  RED: { status: 'RED', label: 'Low' },
  UNKNOWN: { status: 'UNKNOWN', label: 'Not rated yet' },
}

/**
 * Dashboard (UX_PATTERNS → Dashboard): what is happening, what needs attention, what to do next.
 * Headline figures come from analytics (last 7 days); live counts and state come from their
 * owning endpoints. It stays an operational summary, not a second Analytics page.
 */
export function Dashboard({ health }: { health: ApiHealthView }) {
  const { tenantId, can, me } = useSession()
  const connections = useConnections()
  const wallet = useWallet()
  const status = useWorkspaceStatus()
  // Headline figures from analytics (last 7 days, workspace timezone), when the role may see them.
  const analytics = useAnalytics<OverviewAnalytics>(
    'overview',
    { kind: 'preset', days: 7 },
    can('analytics.read'),
  )
  const a = analytics.data?.meta.freshness.status === 'NOT_STARTED' ? undefined : analytics.data
  const conversationsCount = (params: string) =>
    get<{ data: Conversation[] }>(`/conversations?${params}&limit=${MAX}`).then(
      (r) => r.data.length,
    )
  const open = useQuery({
    queryKey: keys.tenant(tenantId, 'dashboard', 'open'),
    queryFn: () => conversationsCount('view=all&status=OPEN'),
    enabled: can('inbox.read'),
    refetchInterval: 60_000,
  })
  const unassigned = useQuery({
    queryKey: keys.tenant(tenantId, 'dashboard', 'unassigned'),
    queryFn: () => conversationsCount('view=unassigned'),
    enabled: can('inbox.read'),
    refetchInterval: 60_000,
  })
  const campaigns = useQuery({
    queryKey: keys.tenant(tenantId, 'campaigns', 'list'),
    queryFn: () => get<{ data: Campaign[] }>('/campaigns').then((r) => r.data),
    enabled: can('campaigns.read'),
  })
  const rejected = useQuery({
    queryKey: keys.tenant(tenantId, 'dashboard', 'rejected-templates'),
    queryFn: () =>
      get<{ data: Template[] }>('/templates?status=REJECTED').then((r) => r.data.length),
    enabled: can('templates.read'),
  })

  const conn = connectionSummary(connections.data)
  /** The billing domain's state (P11-D12); amounts only with billing.read. */
  const ws = status.data?.wallet
  const worstQuality = (() => {
    const live = (connections.data ?? []).filter((c) => c.status !== 'PENDING')
    for (const q of ['RED', 'YELLOW', 'GREEN'] as const)
      if (live.some((c) => c.qualityRating === q)) return q
    return 'UNKNOWN' as const
  })()
  const paused = (campaigns.data ?? []).filter((c) => c.status.startsWith('PAUSED'))

  const attention: Attention[] = []
  if (can('whatsapp.read') && connections.data) {
    if (conn.status === 'NONE')
      attention.push({
        id: 'connect',
        tone: 'info',
        title: 'Connect a WhatsApp number',
        body: 'Nothing can be sent or received until a WhatsApp Business number is connected.',
        href: '/integrations/whatsapp',
        action: 'Connect',
      })
    else if (conn.status !== 'CONNECTED')
      attention.push({
        id: 'whatsapp',
        tone: conn.status === 'FLAGGED' ? 'warning' : 'danger',
        title:
          conn.status === 'FLAGGED'
            ? 'Meta flagged your WhatsApp number'
            : 'WhatsApp needs attention',
        body:
          conn.status === 'FLAGGED'
            ? 'Message quality is dropping. Sending limits may be lowered if it continues.'
            : 'Messages can’t be sent from a disconnected or restricted number.',
        href: '/integrations/whatsapp',
        action: 'Review connection',
      })
  }
  if (ws && (ws.state === 'INSUFFICIENT_FUNDS' || ws.state === 'LOW_BALANCE')) {
    const empty = ws.state === 'INSUFFICIENT_FUNDS'
    const available =
      ws.availableMinor === null ? null : formatMoney(ws.availableMinor, ws.currency)
    attention.push({
      id: 'wallet',
      tone: empty ? 'danger' : 'warning',
      title: empty ? 'Your wallet is out of credits' : 'Wallet balance is low',
      body: empty
        ? `Template messages and campaigns pause until credits are added. Replies inside the 24-hour window still work.${can('billing.read') ? '' : ' Ask a workspace owner or admin to add credits.'}`
        : `${available ? `${available} available. ` : ''}Template messages and campaigns stop when it runs out.${can('billing.read') ? '' : ' Ask a workspace owner or admin to add credits.'}`,
      href: can('billing.read') ? '/billing/wallet' : '',
      action: 'Open wallet',
    })
  }
  if (unassigned.data)
    attention.push({
      id: 'unassigned',
      tone: 'warning',
      title: `${count(unassigned.data)} conversation${unassigned.data > 1 ? 's' : ''} waiting for an owner`,
      body: 'Unassigned conversations may go unanswered.',
      href: '/inbox',
      action: 'Open inbox',
    })
  if (a && a.kpis.failed.value > 0)
    attention.push({
      id: 'failed-messages',
      tone: 'warning',
      title: `${a.kpis.failed.value.toLocaleString('en-IN')} message${a.kpis.failed.value > 1 ? 's' : ''} failed in the last 7 days`,
      body: 'See which numbers, categories and error codes are affected.',
      href: '/analytics/messaging',
      action: 'Review failures',
    })
  if (a && a.kpis.automationFailures.value > 0)
    attention.push({
      id: 'automation-failures',
      tone: 'warning',
      title: `${a.kpis.automationFailures.value.toLocaleString('en-IN')} automation run${a.kpis.automationFailures.value > 1 ? 's' : ''} failed in the last 7 days`,
      body: 'Open the automation to see the failed step and its error.',
      href: '/analytics/automations',
      action: 'Review automations',
    })
  if (paused.length)
    attention.push({
      id: 'paused',
      tone: 'warning',
      title: `${paused.length} campaign${paused.length > 1 ? 's are' : ' is'} paused`,
      body: paused.map((c) => c.name).join(', '),
      href: `/campaigns/${paused[0]!.id}`,
      action: paused.length > 1 ? 'Open the first' : 'Open campaign',
    })
  if (rejected.data)
    attention.push({
      id: 'rejected',
      tone: 'danger',
      title: `${rejected.data} template${rejected.data > 1 ? 's were' : ' was'} rejected by Meta`,
      body: 'See Meta’s reason, fix the content and submit it again.',
      href: '/templates',
      action: 'Review templates',
    })

  const loadingAttention =
    (can('whatsapp.read') && connections.isPending) ||
    (can('inbox.read') && unassigned.isPending) ||
    (can('campaigns.read') && campaigns.isPending) ||
    (can('templates.read') && rejected.isPending) ||
    status.isPending
  const failedAttention =
    connections.isError ||
    unassigned.isError ||
    campaigns.isError ||
    rejected.isError ||
    status.isError ||
    analytics.isError
  const retryAttention = () => {
    void status.refetch()
    if (can('whatsapp.read')) void connections.refetch()
    if (can('inbox.read')) void unassigned.refetch()
    if (can('campaigns.read')) void campaigns.refetch()
    if (can('templates.read')) void rejected.refetch()
    if (can('analytics.read')) void analytics.refetch()
  }

  return (
    <DashboardLayout
      header={{
        title: 'Home',
        description: `Welcome back, ${me.user.name}. Here’s what needs you in your WhatsApp workspace.`,
        actions: can('campaigns.write') ? (
          <Button asChild>
            <Link href="/campaigns/new">Create campaign</Link>
          </Button>
        ) : undefined,
      }}
      attention={
        <Card>
          <CardHeader>
            <CardTitle as="h2" id="attention">
              Needs attention
            </CardTitle>
          </CardHeader>
          <CardContent>
            <section aria-labelledby="attention" className="flex flex-col gap-3">
              {loadingAttention && !attention.length ? (
                <Skeleton className="h-32 w-full" />
              ) : attention.length ? (
                <ul className="divide-y divide-border">
                  {attention.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-start gap-3 py-3">
                      <CircleAlert
                        className={
                          a.tone === 'danger'
                            ? 'mt-0.5 size-5 shrink-0 text-danger-strong'
                            : a.tone === 'warning'
                              ? 'mt-0.5 size-5 shrink-0 text-warning-strong'
                              : 'mt-0.5 size-5 shrink-0 text-info-strong'
                        }
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate">{a.title}</p>
                        <p className="mt-1 text-sm text-secondary">{a.body}</p>
                      </div>
                      {a.href ? (
                        <Button variant="secondary" size="sm" asChild>
                          <Link href={a.href}>{a.action}</Link>
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : !failedAttention ? (
                <p className="flex items-center gap-2 py-4 text-sm text-secondary">
                  <CircleCheck className="size-5 text-success-strong" aria-hidden="true" />
                  All clear. Nothing needs your attention right now.
                </p>
              ) : null}
              {failedAttention ? (
                <ErrorState
                  title="Some workspace activity couldn’t be loaded"
                  description="This summary may be incomplete. Retry to check what needs attention."
                  onRetry={retryAttention}
                />
              ) : null}
            </section>
          </CardContent>
        </Card>
      }
      aside={
        can('campaigns.read') ? (
          <CampaignActivity
            campaigns={campaigns.data}
            error={campaigns.isError}
            retry={() => void campaigns.refetch()}
          />
        ) : undefined
      }
      metrics={
        <>
          <MetricCard
            compact
            label="Messages sent (7 days)"
            icon={<Send />}
            loading={can('analytics.read') && analytics.isPending}
            value={a ? a.kpis.sent.value.toLocaleString('en-IN') : '—'}
            delta={a ? countDelta(a.kpis.sent) : undefined}
            hint={
              can('analytics.read') ? (
                <Link className="underline-offset-4 hover:underline" href="/analytics/messaging">
                  Messaging analytics
                </Link>
              ) : (
                'Your role can’t view analytics'
              )
            }
          />
          <MetricCard
            compact
            label="Open conversations"
            icon={<MessageSquare />}
            loading={can('inbox.read') && open.isPending}
            value={can('inbox.read') ? (count(open.data) ?? '—') : '—'}
            hint={
              <Link className="underline-offset-4 hover:underline" href="/inbox">
                Go to inbox
              </Link>
            }
          />
          <MetricCard
            compact
            label="Delivery rate (7 days)"
            icon={<HeartPulse />}
            loading={can('analytics.read') && analytics.isPending}
            value={a ? percent(a.kpis.deliveryRate.value) : '—'}
            delta={a ? rateDelta(a.kpis.deliveryRate) : undefined}
            hint={
              conn.status === 'NONE' ? (
                'Connect a number to see Meta’s quality rating'
              ) : (
                <span className="flex flex-wrap items-center gap-2">
                  <span>Meta quality</span>
                  <StatusBadge status={QUALITY[worstQuality].status} />
                </span>
              )
            }
          />
          <MetricCard
            compact
            label="Wallet"
            icon={<Wallet />}
            loading={can('billing.read') && wallet.isPending}
            value={
              !wallet.data
                ? '—'
                : wallet.data.enforced
                  ? formatMoney(wallet.data.availableMinor, wallet.data.currency)
                  : 'Not charged'
            }
            hint={
              !wallet.data ? (
                can('billing.read') ? (
                  'Wallet balance is unavailable'
                ) : (
                  'Your role can’t view billing'
                )
              ) : (
                <span className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={wallet.data.state} />
                  <Link className="underline-offset-4 hover:underline" href="/billing/wallet">
                    Open wallet
                  </Link>
                </span>
              )
            }
          />
        </>
      }
    >
      {can('analytics.read') && analytics.data?.meta.freshness.status === 'NOT_STARTED' ? (
        <p role="status" className="text-sm text-secondary">
          Analytics are being prepared. Seven-day figures will appear after processing.
        </p>
      ) : null}
      {can('inbox.read') ? <RecentConversations /> : null}
      {can('automations.read') ? <AutomationActivity /> : null}
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-secondary">
        {can('whatsapp.read') && connections.data ? (
          <ConnectionState status={conn.status} name="WhatsApp" variant="compact" />
        ) : null}
        <div data-testid="api-overall">
          {health.reachable && health.overall === 'ok' ? (
            <span className="flex items-center gap-2">
              <Activity className="size-4 text-success-strong" aria-hidden="true" />
              All systems operational · API {health.version}
            </span>
          ) : (
            <Alert tone="danger" title="Some services are degraded">
              {health.reachable
                ? 'One or more dependencies are not responding.'
                : `The API is unreachable (${health.reason}).`}
            </Alert>
          )}
        </div>
      </div>
    </DashboardLayout>
  )
}

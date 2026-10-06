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
  SectionHeader,
  Skeleton,
  StatusBadge,
  type StatusKey,
} from '@fenwira/ui'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  CircleCheck,
  FileText,
  HeartPulse,
  Megaphone,
  MessageSquare,
  Plus,
  Send,
  Wallet,
  Workflow,
} from 'lucide-react'
import Link from 'next/link'
import { type ReactNode } from 'react'
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
  const { tenantId, can } = useSession()
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
    connections.isPending || unassigned.isPending || campaigns.isPending || rejected.isPending

  return (
    <DashboardLayout
      header={{
        title: 'Home',
        description: 'What’s happening in your WhatsApp workspace, and what needs you.',
      }}
      attention={
        <section aria-labelledby="attention" className="flex flex-col gap-3">
          <SectionHeader id="attention" title="Needs attention" />
          {loadingAttention && !attention.length ? (
            <Skeleton className="h-16 w-full" />
          ) : attention.length ? (
            <ul className="flex flex-col gap-2">
              {attention.map((a) => (
                <li key={a.id}>
                  <Alert
                    tone={a.tone}
                    title={a.title}
                    action={
                      a.href ? (
                        <Button variant="secondary" size="sm" asChild>
                          <Link href={a.href}>{a.action}</Link>
                        </Button>
                      ) : undefined
                    }
                  >
                    {a.body}
                  </Alert>
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 rounded-lg border border-border bg-surface p-4 text-base text-slate">
              <CircleCheck className="size-5 text-success-strong" aria-hidden="true" />
              All clear. Nothing needs your attention right now.
            </p>
          )}
        </section>
      }
      metrics={
        <>
          <MetricCard
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
                'Your role can’t view billing'
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
      aside={
        <>
          <Card>
            <CardHeader>
              <CardTitle as="h2">WhatsApp</CardTitle>
            </CardHeader>
            <CardContent>
              {connections.isPending ? (
                <Skeleton className="h-10" />
              ) : (
                <ConnectionState
                  status={conn.status}
                  name={conn.name}
                  action={
                    <Button variant="secondary" size="sm" asChild>
                      <Link href="/integrations/whatsapp">Manage</Link>
                    </Button>
                  }
                />
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle as="h2">System status</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2" data-testid="api-overall">
              {health.reachable && health.overall === 'ok' ? (
                <p className="flex items-center gap-2 text-base text-slate">
                  <Activity className="size-4 text-success-strong" aria-hidden="true" />
                  All systems operational · API {health.version}
                </p>
              ) : (
                <Alert tone="danger" title="Some services are degraded">
                  {health.reachable
                    ? 'One or more dependencies are not responding.'
                    : `The API is unreachable (${health.reason}).`}
                </Alert>
              )}
            </CardContent>
          </Card>
        </>
      }
    >
      <section aria-labelledby="shortcuts" className="flex flex-col gap-3">
        <SectionHeader id="shortcuts" title="Get things done" />
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              [
                'inbox.read',
                '/inbox',
                'Reply to customers',
                'Open the shared inbox',
                MessageSquare,
              ],
              [
                'campaigns.write',
                '/campaigns/new',
                'Send a campaign',
                'Reach a tag, segment or import',
                Megaphone,
              ],
              [
                'templates.write',
                '/templates/new',
                'Create a template',
                'Get a message approved by Meta',
                FileText,
              ],
              [
                'automations.write',
                '/automations/new',
                'Automate a reply',
                'Start from a recipe',
                Workflow,
              ],
            ] as const
          )
            .filter(([perm]) => can(perm))
            .map(([, href, title, sub, Icon]) => (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-3 rounded-lg border border-border bg-surface p-4 hover:border-border-strong"
              >
                <span className="flex size-9 items-center justify-center rounded-md bg-primary-soft text-primary-strong">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <span className="flex flex-col">
                  <span className="font-medium text-slate">{title}</span>
                  <span className="text-sm text-secondary">{sub}</span>
                </span>
                <Plus className="ml-auto size-4 text-muted" aria-hidden="true" />
              </Link>
            ))}
        </div>
      </section>
      {can('campaigns.read') ? <RecentCampaigns campaigns={campaigns.data} /> : null}
    </DashboardLayout>
  )
}

function RecentCampaigns({ campaigns }: { campaigns: Campaign[] | undefined }): ReactNode {
  const recent = (campaigns ?? []).slice(0, 5)
  return (
    <section aria-labelledby="recent-campaigns" className="flex flex-col gap-3">
      <SectionHeader
        id="recent-campaigns"
        title="Recent campaigns"
        actions={
          <Button variant="link" asChild>
            <Link href="/campaigns">All campaigns</Link>
          </Button>
        }
      />
      {!campaigns ? (
        <Skeleton className="h-24 w-full" />
      ) : recent.length ? (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {recent.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <Link
                href={`/campaigns/${c.id}`}
                className="truncate font-medium text-slate underline-offset-4 hover:underline"
              >
                {c.name}
              </Link>
              <StatusBadge status={c.status} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-border bg-surface p-4 text-base text-secondary">
          No campaigns yet. When you send one, its progress shows here.
        </p>
      )}
    </section>
  )
}

'use client'

import {
  type Campaign,
  type Conversation,
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
  UserX,
  Wallet,
  Workflow,
} from 'lucide-react'
import Link from 'next/link'
import { type ReactNode } from 'react'
import { useSession } from '@/components/session/session-provider'
import { get } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { type ApiHealthView } from '@/lib/health'
import {
  connectionSummary,
  formatMoney,
  useConnections,
  useWallet,
  walletState,
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
 * Built only from existing endpoints; metrics that need Phase 11 analytics are not faked.
 */
export function Dashboard({ health }: { health: ApiHealthView }) {
  const { tenantId, can } = useSession()
  const connections = useConnections()
  const wallet = useWallet()
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
  const ws = walletState(wallet.data)
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
  if ((ws === 'EMPTY' || ws === 'LOW') && wallet.data)
    attention.push({
      id: 'wallet',
      tone: ws === 'EMPTY' ? 'danger' : 'warning',
      title: ws === 'EMPTY' ? 'Your wallet is empty' : 'Wallet balance is low',
      body:
        ws === 'EMPTY'
          ? 'Template messages and campaigns pause until credit is added. Replies inside the 24-hour window still work.'
          : `${formatMoney(wallet.data.availableMinor, wallet.data.currency)} available. Campaigns pause when it runs out.`,
      href: '/dashboard',
      action: 'Contact your admin',
    })
  if (unassigned.data)
    attention.push({
      id: 'unassigned',
      tone: 'warning',
      title: `${count(unassigned.data)} conversation${unassigned.data > 1 ? 's' : ''} waiting for an owner`,
      body: 'Unassigned conversations may go unanswered.',
      href: '/inbox',
      action: 'Open inbox',
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
        title: 'Dashboard',
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
                      a.id === 'wallet' ? undefined : (
                        <Button variant="secondary" size="sm" asChild>
                          <Link href={a.href}>{a.action}</Link>
                        </Button>
                      )
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
            label="Unassigned"
            icon={<UserX />}
            loading={can('inbox.read') && unassigned.isPending}
            value={can('inbox.read') ? (count(unassigned.data) ?? '—') : '—'}
            hint="Waiting for a teammate"
          />
          <MetricCard
            label="Delivery health"
            icon={<HeartPulse />}
            loading={connections.isPending && can('whatsapp.read')}
            value={conn.status === 'NONE' ? 'No number' : QUALITY[worstQuality].label}
            hint={
              conn.status === 'NONE' ? (
                'Connect a number to see Meta’s quality rating'
              ) : (
                <StatusBadge status={QUALITY[worstQuality].status} />
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
              !wallet.data
                ? 'Your role can’t view billing'
                : wallet.data.enforced
                  ? `${formatMoney(wallet.data.reservedMinor, wallet.data.currency)} held for sends in progress`
                  : 'Messages aren’t billed in this workspace'
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

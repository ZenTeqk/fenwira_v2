'use client'
import { WorkspaceActivity } from './platform-overview'
import {
  ENTITLEMENT_LABELS,
  platformFinancialSchema,
  platformWorkspaceSchema,
  type EntitlementKey,
} from '@fenwira/contracts'
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailPage,
  EmptyState,
  ErrorState,
  Skeleton,
  StatusBadge,
  SummaryItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Timeline,
  type StatusKey,
} from '@fenwira/ui'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { platformMoney, platformRequest } from '@/lib/platform'
import { CommercialActions, ReceiptDetails } from './commercial-actions'
import { DeleteWorkspace } from './delete-workspace'
import { usePlatform } from './platform-shell'
import { WorkspaceMembers } from './platform-accounts'
import { WorkspaceInvoices } from './workspace-invoices'
import { WorkspaceNextSteps, useWorkspaceParts } from './workspace-next-steps'
import { WorkspaceAi } from './workspace-ai'
import { WorkspaceWhatsApp } from './workspace-whatsapp'
const valueLabel = (v: boolean | number | null) =>
  v === null
    ? 'Unlimited'
    : typeof v === 'boolean'
      ? v
        ? 'Enabled'
        : 'Disabled'
      : v.toLocaleString()
export function WorkspaceCommercialView({ id }: { id: string }) {
  const me = usePlatform()
  const result = useQuery({
    queryKey: ['platform', 'workspace', id],
    retry: false,
    queryFn: async () => platformWorkspaceSchema.parse(await platformRequest(`/workspaces/${id}`)),
  })
  const financial = useQuery({
    queryKey: ['platform', 'financial', id],
    enabled: me?.permissions.includes('financial.read') ?? false,
    retry: false,
    queryFn: async () =>
      platformFinancialSchema.parse(await platformRequest(`/workspaces/${id}/financial`)),
  })
  const parts = useWorkspaceParts(id)
  if (result.isPending) return <Skeleton className="h-32 w-full" />
  if (result.isError) return <ErrorState onRetry={() => void result.refetch()} />
  const data = result.data,
    { workspace, wallet, subscription } = data.snapshot
  const plan = data.plans.find((p) => p.id === subscription?.planId)
  const { members } = parts
  return (
    <DetailPage
      header={{
        title: workspace.name,
        description: `${workspace.slug} · ${workspace.id}. Plan, team, WhatsApp, invoices and activity for this workspace. See docs/MANAGED_LAUNCH.md § 3.`,
        actions: (
          <Button asChild variant="secondary">
            <Link href="/platform/workspaces">Back to workspaces</Link>
          </Button>
        ),
      }}
      banner={
        <Alert tone="info" title="Commercial workspace view">
          Subscription enforcement:{' '}
          {data.subscriptionsEnforced ? 'enabled by rollout configuration' : 'not enabled'}.
          Configured entitlements and currently enforced access are shown separately.
        </Alert>
      }
      summary={
        <>
          <SummaryItem label="Subscription">
            {subscription ? (
              <StatusBadge
                label={subscription.status === 'TRIALING' ? 'Trial' : undefined}
                status={
                  subscription.status === 'TRIALING'
                    ? 'PENDING'
                    : (subscription.status as StatusKey)
                }
              />
            ) : (
              'No record'
            )}
          </SummaryItem>
          <SummaryItem label="Plan">
            {workspace.isInternal ? 'Business (internal)' : (plan?.name ?? 'Not chosen yet')}
          </SummaryItem>
          <SummaryItem label="Workspace type">
            {workspace.isInternal ? 'Internal (Fenwira, no billing)' : 'Customer'}
          </SummaryItem>
          <SummaryItem label="Owner">
            {members.data?.find((m) => m.role === 'OWNER')?.email ?? '—'}
          </SummaryItem>
          <SummaryItem label="Billing mode">{workspace.billingMode}</SummaryItem>
          <SummaryItem label="Available funds">
            {wallet
              ? platformMoney(wallet.availableMinor, wallet.currency)
              : 'Wallet not initialized'}
          </SummaryItem>
        </>
      }
    >
      <WorkspaceNextSteps data={data} />
      <WorkspaceMembers workspaceId={workspace.id} />
      <WorkspaceWhatsApp workspaceId={workspace.id} name={workspace.name} />
      <WorkspaceAi workspaceId={workspace.id} />
      <WorkspaceActivity workspaceId={workspace.id} />
      <WorkspaceInvoices workspaceId={workspace.id} name={workspace.name} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle as="h2">Subscription & wallet</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4">
              <SummaryItem label="Trial ends">
                {subscription?.trialEndsAt
                  ? new Date(subscription.trialEndsAt).toLocaleString()
                  : '—'}
              </SummaryItem>
              <SummaryItem label="Current period ends">
                {subscription?.currentPeriodEnd
                  ? new Date(subscription.currentPeriodEnd).toLocaleString()
                  : '—'}
              </SummaryItem>
              <SummaryItem label="Period-end cancellation">
                {subscription?.cancelAtPeriodEnd ? 'Requested' : 'None'}
              </SummaryItem>
              <SummaryItem label="Requested plan">
                {data.plans.find((p) => p.id === subscription?.requestedPlanId)?.name ?? 'None'}
              </SummaryItem>
              <SummaryItem label="Ledger balance">
                {wallet ? platformMoney(wallet.balanceMinor, wallet.currency) : '—'}
              </SummaryItem>
              <SummaryItem label="Active reservations">
                {wallet ? platformMoney(wallet.reservedMinor, wallet.currency) : '—'}
              </SummaryItem>
            </dl>
            <p className="mt-4 text-sm text-secondary">
              {data.credits
                .map(
                  (c) =>
                    `${c.fundType === 'PAID' ? 'Paid' : 'Promotional'} grants: ${platformMoney(c.grantedMinor, wallet?.currency ?? 'INR')}`,
                )
                .join(' · ') || 'No credit grants'}
              . Grants are historical totals; remaining paid/promotional balances are not allocated.
            </p>
            {!data.reconciliation.balanceMatches || !data.reconciliation.reservationsMatch ? (
              <Alert tone="danger" title="Reconciliation requires investigation">
                Ledger balance or active reservations differ from cached state.
              </Alert>
            ) : (
              <p className="mt-3 text-sm text-secondary">
                Ledger and reservation totals reconcile.
              </p>
            )}
          </CardContent>
        </Card>
        {me?.permissions.includes('financial.read') ? (
          <Card>
            <CardHeader>
              <CardTitle as="h2">Internal financial visibility</CardTitle>
            </CardHeader>
            <CardContent>
              {financial.isPending ? (
                <Skeleton className="h-24 w-full" />
              ) : financial.isError ? (
                <ErrorState onRetry={() => void financial.refetch()} />
              ) : (
                <>
                  <dl className="grid grid-cols-2 gap-4">
                    <SummaryItem label="Gross customer usage charges">
                      {platformMoney(financial.data.customerChargeMinor, financial.data.currency)}
                    </SummaryItem>
                    <SummaryItem label="Recorded provider cost">
                      {platformMoney(financial.data.providerCostMinor, financial.data.currency)}
                    </SummaryItem>
                    <SummaryItem label="Recorded gross contribution">
                      {platformMoney(
                        financial.data.recordedContributionMinor,
                        financial.data.currency,
                      )}
                    </SummaryItem>
                    <SummaryItem label="Cost coverage">
                      {financial.data.costKnownMessages} / {financial.data.messages} usage records
                    </SummaryItem>
                  </dl>
                  <p className="mt-4 text-sm text-secondary">
                    {financial.data.costProvenance} Missing costs are excluded. Gross contribution
                    excludes support refunds and adjustments.
                  </p>
                  <p className="mt-2 text-sm text-secondary">
                    Tax metadata:{' '}
                    {financial.data.taxMetadata
                      .map(
                        (t) =>
                          `${t.category}: ${t.taxCode ?? 'unset'}${t.isPlaceholder ? ' (placeholder)' : ''}`,
                      )
                      .join('; ') || 'Unavailable'}
                    . No invoice calculation.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
      <section aria-labelledby="entitlement-heading">
        <h2 id="entitlement-heading" className="mb-3 text-lg font-semibold">
          Entitlements & limits
        </h2>
        <Table containerLabel="Commercial records">
          <TableHeader>
            <TableRow>
              <TableHead>Entitlement</TableHead>
              <TableHead>Configured</TableHead>
              <TableHead>Enforced</TableHead>
              <TableHead>Usage</TableHead>
              <TableHead>Limit state</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.entitlements.map((e) => (
              <TableRow key={e.key}>
                <TableCell>{ENTITLEMENT_LABELS[e.key as EntitlementKey] ?? e.key}</TableCell>
                <TableCell>{valueLabel(e.configured)}</TableCell>
                <TableCell>{valueLabel(e.enforced)}</TableCell>
                <TableCell>{e.usage ?? '—'}</TableCell>
                <TableCell>
                  <StatusBadge status={e.overLimit ? 'RESTRICTED' : 'VALID'} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
      <section id="operations" aria-labelledby="activity-heading">
        <h2 id="activity-heading" className="mb-3 text-lg font-semibold">
          Commercial activity
        </h2>
        <Timeline
          label="Recent commercial operations"
          items={data.operations.map((r) => ({
            id: r.id,
            title: r.operation.replaceAll('_', ' '),
            time: new Date(r.createdAt).toLocaleString(),
            details: <ReceiptDetails receipt={r} />,
            description: `${r.reason} · ${r.reference}${r.amountMinor ? ` · ${platformMoney(r.amountMinor)}` : ''}`,
          }))}
          empty="No commercial operations recorded."
        />
      </section>
      <section aria-labelledby="ledger-heading">
        <h2 id="ledger-heading" className="mb-3 text-lg font-semibold">
          Recent wallet entries
        </h2>
        {data.ledger.length ? (
          <Table containerLabel="Commercial records">
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Operation</TableHead>
                <TableHead>Fund identity</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Reason / expiry metadata</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.ledger.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{new Date(l.createdAt).toLocaleString()}</TableCell>
                  <TableCell>{l.type}</TableCell>
                  <TableCell>{l.fundType}</TableCell>
                  <TableCell>{platformMoney(l.amountMinor, wallet?.currency ?? 'INR')}</TableCell>
                  <TableCell>
                    {l.reason}
                    {l.expiresAt ? ` · ${new Date(l.expiresAt).toLocaleString()}` : ''}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState title="No wallet entries" />
        )}
      </section>
      <div id="operations">
        <CommercialActions data={data} />
      </div>
      <DeleteWorkspace workspace={workspace} />
    </DetailPage>
  )
}

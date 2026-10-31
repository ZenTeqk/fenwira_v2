'use client'

import { useManagedBillingRedirect } from '@/components/billing/managed-billing'
import { type UsageAnalytics } from '@fenwira/contracts'
import { type ChartTone, MetricCard, PermissionState, TrendChart, textLink } from '@fenwira/ui'
import { Gift, Receipt, Send } from 'lucide-react'
import Link from 'next/link'
import { AnalyticsFrame, KpiGrid, Panel } from '@/components/analytics/analytics-frame'
import { BreakdownTable } from '@/components/analytics/breakdown-table'
import { useSession } from '@/components/session/session-provider'
import { count, countDelta, shortDay, useAnalytics, useAnalyticsRange } from '@/lib/analytics'
import { formatMoney } from '@/lib/billing'

const CATEGORY_LABEL: Record<string, string> = {
  MARKETING: 'Marketing',
  UTILITY: 'Utility',
  AUTHENTICATION: 'Authentication',
  SERVICE: 'Service',
}
/**
 * Colour follows the category, never its position, so a period without one category doesn't
 * repaint the rest. The stacking order is the validated one (no colour-blind-ambiguous neighbours).
 */
const CATEGORY_TONE = {
  UTILITY: 'blue',
  AUTHENTICATION: 'orange',
  MARKETING: 'violet',
  SERVICE: 'aqua',
} as const satisfies Record<string, ChartTone>
const CATEGORY_ORDER = Object.keys(CATEGORY_TONE)
const order = (key: string) =>
  CATEGORY_ORDER.includes(key) ? CATEGORY_ORDER.indexOf(key) : CATEGORY_ORDER.length

/**
 * Analytics → Usage. Charges come from usage events (the source of every wallet debit), so they
 * reconcile with the ledger; balances are never computed here (the Wallet page shows them).
 */
function UsageAnalyticsPageContent() {
  const { can } = useSession()
  const [range, setRange] = useAnalyticsRange()
  const query = useAnalytics<UsageAnalytics>('usage', range, can('billing.read'))
  if (!can('billing.read'))
    return <PermissionState what="usage and charges" permission="billing.read" />
  return (
    <AnalyticsFrame
      title="Usage"
      description="Billable WhatsApp messages and what they were charged."
      range={range}
      onRangeChange={setRange}
      query={query}
    >
      {(d) => {
        const money = (minor: number) => formatMoney(minor, d.currency)
        const categories = d.byCategory.map((c) => c.key).sort((a, b) => order(a) - order(b))
        return (
          <>
            <KpiGrid>
              <MetricCard
                appearance="analytics"
                label="Billable messages"
                icon={<Send />}
                value={count(d.kpis.billableMessages.value)}
                delta={countDelta(d.kpis.billableMessages)}
                hint="Messages Meta charged for"
              />
              <MetricCard
                appearance="analytics"
                label="Message charges"
                icon={<Receipt />}
                value={money(d.kpis.chargeMinor.value)}
                delta={countDelta(d.kpis.chargeMinor, false)}
                hint="Debited from the wallet"
              />
              <MetricCard
                appearance="analytics"
                label="Promotional credits added"
                icon={<Gift />}
                value={money(d.kpis.promotionalCreditsMinor.value)}
                hint={
                  <Link className={textLink} href="/billing/wallet">
                    Balance and transactions
                  </Link>
                }
              />
            </KpiGrid>
            <Panel title="Charges per day by category">
              <TrendChart
                label="Message charges per day by category"
                variant="stacked"
                formatValue={money}
                data={d.series.map((p) => ({ label: shortDay(p.day), values: p.values }))}
                series={categories.map((k) => ({
                  key: k,
                  label: CATEGORY_LABEL[k] ?? k,
                  tone: CATEGORY_TONE[k as keyof typeof CATEGORY_TONE] ?? 'other',
                }))}
              />
            </Panel>
            <Panel title="By category">
              <BreakdownTable
                label="Usage by category"
                dimension="Category"
                rows={d.byCategory}
                columns={[
                  { key: 'messages', label: 'Messages' },
                  { key: 'chargeMinor', label: 'Charges', format: (v) => money(v) },
                ]}
                empty="No billable messages in this period."
              />
            </Panel>
          </>
        )
      }}
    </AnalyticsFrame>
  )
}

export default function UsageAnalyticsPage() {
  return useManagedBillingRedirect() ? null : <UsageAnalyticsPageContent />
}

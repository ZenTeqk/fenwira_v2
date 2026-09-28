'use client'

import { type UsageAnalytics } from '@fenwira/contracts'
import { MetricCard, PermissionState, TrendChart } from '@fenwira/ui'
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
const TONES = ['primary', 'info', 'success', 'warning'] as const

/**
 * Analytics → Usage. Charges come from usage events (the source of every wallet debit), so they
 * reconcile with the ledger; balances are never computed here (the Wallet page shows them).
 */
export default function UsageAnalyticsPage() {
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
        const categories = d.byCategory.map((c) => c.key)
        return (
          <>
            <KpiGrid>
              <MetricCard
                label="Billable messages"
                icon={<Send />}
                value={count(d.kpis.billableMessages.value)}
                delta={countDelta(d.kpis.billableMessages)}
                hint="Messages Meta charged for"
              />
              <MetricCard
                label="Message charges"
                icon={<Receipt />}
                value={money(d.kpis.chargeMinor.value)}
                delta={countDelta(d.kpis.chargeMinor, false)}
                hint="Debited from the wallet"
              />
              <MetricCard
                label="Promotional credits added"
                icon={<Gift />}
                value={money(d.kpis.promotionalCreditsMinor.value)}
                hint={
                  <Link className="underline-offset-4 hover:underline" href="/billing/wallet">
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
                series={categories.map((k, i) => ({
                  key: k,
                  label: CATEGORY_LABEL[k] ?? k,
                  tone: TONES[i % TONES.length]!,
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

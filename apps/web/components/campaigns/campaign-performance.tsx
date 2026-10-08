'use client'

import type { Campaign, CampaignStats } from '@fenwira/contracts'
import { Card, CardContent, MetricCard, Progress } from '@fenwira/ui'
import { CheckCheck, Eye, Send, TriangleAlert } from 'lucide-react'
import { percent } from '@/lib/campaigns'

/** Inclusive delivery counters share one audience scale; never sum stages into a pie. */
export function CampaignPerformance({
  campaign,
  stats: s,
}: {
  campaign: Campaign
  stats: CampaignStats
}) {
  if (!campaign.audienceSnapshotAt)
    return (
      <Card>
        <CardContent className="flex flex-col gap-2 p-4">
          <h2 className="text-md font-semibold text-slate">Delivery overview</h2>
          <p className="text-sm text-secondary">
            Results appear after the audience is prepared. No messages have been reported yet.
          </p>
        </CardContent>
      </Card>
    )
  return (
    <section aria-label="Campaign results" className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard compact label="Sent" value={s.sent.toLocaleString('en-IN')} icon={<Send />} />
        <MetricCard
          compact
          label="Delivered"
          value={s.delivered.toLocaleString('en-IN')}
          icon={<CheckCheck />}
        />
        <MetricCard compact label="Read" value={s.read.toLocaleString('en-IN')} icon={<Eye />} />
        <MetricCard
          compact
          label="Failed"
          value={s.failed.toLocaleString('en-IN')}
          icon={<TriangleAlert />}
        />
      </div>
      <Card>
        <CardContent className="flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-md font-semibold text-slate">Delivery overview</h2>
              <p className="mt-1 text-sm text-secondary">
                Follow your message from sending to reading.
              </p>
            </div>
            <span className="text-sm text-secondary">
              {s.eligible.toLocaleString('en-IN')} eligible recipients
            </span>
          </div>
          <div className="flex flex-col gap-4" aria-label="Delivery funnel">
            {(
              [
                ['Sent', s.sent, Send],
                ['Delivered', s.delivered, CheckCheck],
                ['Read', s.read, Eye],
              ] as const
            ).map(([label, value, Icon]) => (
              <div key={label} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-strong"
                >
                  <Icon className="size-4" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex justify-between gap-3 text-sm">
                    <span className="font-medium text-slate">{label}</span>
                    <span className="tabular-nums text-secondary">
                      {value.toLocaleString('en-IN')}{' '}
                      <span className="text-muted">/ {s.eligible.toLocaleString('en-IN')}</span>
                    </span>
                  </div>
                  {s.eligible > 0 ? (
                    <Progress
                      label={`${label} reach of eligible audience`}
                      value={value}
                      max={s.eligible}
                      className="h-2"
                    />
                  ) : (
                    <p className="text-xs text-muted">No eligible audience yet</p>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-secondary">
            Bars use the same eligible audience. Read messages are already included in Delivered and
            Sent.
          </p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-4 sm:grid-cols-3">
            {[
              ['Total recipients', s.total.toLocaleString('en-IN')],
              ['Eligible', s.eligible.toLocaleString('en-IN')],
              ['Skipped', s.skipped.toLocaleString('en-IN')],
              ['Waiting', (s.pending + s.queued).toLocaleString('en-IN')],
              ['Delivery rate', percent(s.deliveryRate)],
              ['Read rate', percent(s.readRate)],
              ['Failure rate', percent(s.failureRate)],
              ...(s.durationSeconds !== null
                ? [
                    [
                      'Duration',
                      s.durationSeconds < 60
                        ? `${s.durationSeconds} sec`
                        : `${Math.round(s.durationSeconds / 60)} min`,
                    ],
                  ]
                : []),
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-secondary">{label}</dt>
                <dd className="mt-1 text-base font-semibold tabular-nums text-slate">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted">
            Delivery rate uses attempted messages; read rate uses delivered messages. Waiting
            includes queued messages.
          </p>
        </CardContent>
      </Card>
    </section>
  )
}

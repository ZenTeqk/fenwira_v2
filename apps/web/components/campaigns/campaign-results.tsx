'use client'

import { type Campaign } from '@fenwira/contracts'
import { Button, Progress, Skeleton } from '@fenwira/ui'
import { campaignResultsLive, percent, useCampaignStats } from '@/lib/campaigns'

/** Render existing inclusive sent/delivered/read counts and authoritative rate definitions. */
export function CampaignResults({
  campaign: c,
  compact = false,
}: {
  campaign: Campaign
  compact?: boolean
}) {
  const results = useCampaignStats(c.id, campaignResultsLive(c), Boolean(c.audienceSnapshotAt))
  if (!c.audienceSnapshotAt)
    return (
      <p className="text-xs text-secondary">
        {c.status === 'DRAFT' ? 'Not launched' : 'Audience prepared at launch'}
      </p>
    )
  if (results.isPending) return <Skeleton className="h-12" aria-label="Loading campaign results" />
  if (results.isError || !results.data)
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm text-secondary">
        Results unavailable.
        <Button variant="link" size="sm" onClick={() => void results.refetch()}>
          Retry results
        </Button>
      </div>
    )
  const s = results.data
  return (
    <div className="flex flex-col gap-2" aria-label={`${c.name} delivery results`}>
      {!compact ? (
        <>
          <div className="flex items-center justify-between gap-2 text-sm text-secondary">
            <p>
              <span className="font-semibold text-slate">{s.sent.toLocaleString('en-IN')}</span> /{' '}
              {s.eligible.toLocaleString('en-IN')} sent
            </p>
            <span className="tabular-nums">
              {s.eligible > 0 ? percent(s.sent / s.eligible) : '—'}
            </span>
          </div>
          {s.eligible > 0 ? (
            <Progress
              label={`${c.name}: sent out of eligible recipients`}
              value={s.sent}
              max={s.eligible}
            />
          ) : null}
          {s.failed || s.skipped ? (
            <p className="text-xs text-secondary">
              {s.failed.toLocaleString('en-IN')} failed · {s.skipped.toLocaleString('en-IN')}{' '}
              skipped
            </p>
          ) : null}
        </>
      ) : null}
      <dl className="grid grid-cols-3 gap-3 pt-2 text-sm [&>div+div]:border-l [&>div+div]:border-border [&>div+div]:pl-3">
        {[
          ['Delivered', percent(s.deliveryRate)],
          ['Read', percent(s.readRate)],
          [
            'Started',
            c.startedAt
              ? new Intl.DateTimeFormat('en-IN', {
                  timeStyle: 'short',
                  timeZone: c.timezone,
                }).format(new Date(c.startedAt))
              : 'Not started',
          ],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted">{label}</dt>
            <dd className="text-md font-semibold text-slate">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

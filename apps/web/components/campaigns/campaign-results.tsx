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
          {s.eligible > 0 ? (
            <Progress
              label={`${c.name}: sent out of eligible recipients`}
              value={s.sent}
              max={s.eligible}
            />
          ) : null}
          <p className="text-xs text-secondary">
            {s.sent.toLocaleString('en-IN')} of {s.eligible.toLocaleString('en-IN')} eligible sent ·{' '}
            {(s.pending + s.queued).toLocaleString('en-IN')} waiting
            {s.failed ? ` · ${s.failed.toLocaleString('en-IN')} failed` : ''}
            {s.skipped ? ` · ${s.skipped.toLocaleString('en-IN')} skipped` : ''}
          </p>
        </>
      ) : null}
      <dl className="grid grid-cols-3 gap-3 border-t border-border pt-3 text-sm">
        {[
          ['Sent', s.sent.toLocaleString('en-IN')],
          [
            'Delivered',
            compact
              ? percent(s.deliveryRate)
              : `${s.delivered.toLocaleString('en-IN')} · ${percent(s.deliveryRate)}`,
          ],
          [
            'Read',
            compact
              ? percent(s.readRate)
              : `${s.read.toLocaleString('en-IN')} · ${percent(s.readRate)}`,
          ],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted">{label}</dt>
            <dd className="font-medium text-slate">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

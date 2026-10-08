'use client'
import type { Campaign } from '@fenwira/contracts'
import { Card, CardContent, Timeline, type TimelineItem } from '@fenwira/ui'
import { CalendarDays, CheckCircle2, Clock, FileText, Send, Users, XCircle } from 'lucide-react'
import { campaignAudienceLabel, formatInZone } from '@/lib/campaigns'

/** Stored milestones, not an invented event log or expected future completion. */
export function CampaignContext({ campaign: c }: { campaign: Campaign }) {
  const milestones: TimelineItem[] = [
    {
      id: 'created',
      title: 'Campaign created',
      icon: <FileText />,
      time: formatInZone(c.createdAt, c.timezone),
    },
    ...(c.launchedAt
      ? [
          {
            id: 'launched',
            title: 'Launch approved',
            icon: <Send />,
            time: formatInZone(c.launchedAt, c.timezone),
          },
        ]
      : []),
    ...(c.startedAt
      ? [
          {
            id: 'started',
            title: 'Sending started',
            icon: <Clock />,
            time: formatInZone(c.startedAt, c.timezone),
          },
        ]
      : []),
    ...(c.completedAt
      ? [
          {
            id: 'completed',
            title: 'Campaign completed',
            icon: <CheckCircle2 />,
            time: formatInZone(c.completedAt, c.timezone),
          },
        ]
      : []),
    ...(c.cancelledAt
      ? [
          {
            id: 'cancelled',
            title: 'Campaign cancelled',
            icon: <XCircle />,
            time: formatInZone(c.cancelledAt, c.timezone),
          },
        ]
      : []),
  ]
  return (
    <Card>
      <CardContent className="grid gap-5 p-4 md:grid-cols-2">
        <section aria-label="Audience and timing" className="flex flex-col gap-3">
          <h2 className="text-md font-semibold text-slate">Audience and timing</h2>
          <div className="flex items-start gap-3">
            <Users aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary-strong" />
            <div>
              <p className="text-sm font-medium text-slate">{campaignAudienceLabel(c)}</p>
              <p className="mt-1 text-xs text-secondary">
                {c.audienceSnapshotAt
                  ? `${c.totalRecipients.toLocaleString('en-IN')} recipients frozen at launch`
                  : 'Audience will be prepared at launch'}
                {c.audience.exclude.length ? ' · Exclusions applied' : ''}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <CalendarDays
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0 text-primary-strong"
            />
            <div>
              <p className="text-sm font-medium text-slate">
                {c.status === 'SCHEDULED' && c.scheduleAt
                  ? formatInZone(c.scheduleAt, c.timezone)
                  : c.startedAt
                    ? formatInZone(c.startedAt, c.timezone)
                    : 'Sending has not started'}
              </p>
              <p className="mt-1 text-xs text-secondary">
                {c.timezone}
                {c.status === 'SCHEDULED' ? ' · Planned send' : ''}
              </p>
            </div>
          </div>
          {c.phoneNumberDisplay ? (
            <p className="text-xs text-secondary">Sending number: {c.phoneNumberDisplay}</p>
          ) : null}
        </section>
        <section aria-label="Campaign milestones" className="flex flex-col gap-3">
          <h2 className="text-md font-semibold text-slate">Recorded milestones</h2>
          <Timeline label="Campaign milestone timeline" items={milestones} appearance="activity" />
        </section>
      </CardContent>
    </Card>
  )
}

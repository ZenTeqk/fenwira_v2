'use client'
import type { Campaign } from '@fenwira/contracts'
import { Alert, Button, Card, CardContent, cn, focusRing, StatusBadge } from '@fenwira/ui'
import { ArrowRight, CalendarDays, FileText, Megaphone, Users } from 'lucide-react'
import Link from 'next/link'
import { useSession } from '@/components/session/session-provider'
import { campaignBodyPreview } from '@/lib/campaign-presentation'
import { formatInZone, PAUSE_LABEL } from '@/lib/campaigns'
import { CampaignResults } from './campaign-results'
import { CampaignArtwork, CampaignActions } from './campaign-identity'

export function CampaignCard({
  campaign: c,
  audienceLabel,
}: {
  campaign: Campaign
  audienceLabel: string
}) {
  const { can } = useSession()
  const pause =
    c.status === 'PAUSED_INSUFFICIENT_FUNDS'
      ? 'Add credits, then resume. Unsent recipients are waiting; sent results are preserved.'
      : c.status === 'PAUSED_TEMPLATE_UNAVAILABLE'
        ? 'The frozen template is unavailable. Resume when the same version is sendable, or cancel and create another campaign.'
        : c.status === 'PAUSED'
          ? PAUSE_LABEL[c.pauseReason ?? 'MANUAL']
          : null
  return (
    // Status is the labelled badge, not a coloured card outline.
    <Card data-campaign-card>
      <CardContent className="flex flex-col gap-3 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <CampaignArtwork campaign={c} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/campaigns/${c.id}`}
                  className={cn(
                    'break-words text-sm font-semibold text-fg hover:underline',
                    focusRing,
                  )}
                >
                  {c.name}
                </Link>
                <StatusBadge status={c.status} />
              </div>
              {c.template ? (
                <p
                  className="line-clamp-1 text-sm text-fg-secondary"
                  title={campaignBodyPreview(
                    c.template.components.body.text,
                    c.variableMapping.body,
                  )}
                >
                  {campaignBodyPreview(c.template.components.body.text, c.variableMapping.body)}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-secondary">
                {c.template ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Megaphone aria-hidden="true" className="size-3.5 shrink-0" />
                    {c.template.category === 'MARKETING'
                      ? 'Marketing'
                      : c.template.category === 'UTILITY'
                        ? 'Utility'
                        : 'Authentication'}
                  </span>
                ) : null}
                <span className="inline-flex min-w-0 items-center gap-1.5 break-words">
                  <Users aria-hidden="true" className="size-3.5 shrink-0" />
                  {audienceLabel}
                  {c.audience.exclude.length ? ' · exclusions applied' : ''}
                </span>
                {c.audienceSnapshotAt ? (
                  <span>{c.totalRecipients.toLocaleString('en-IN')} recipients</span>
                ) : null}
              </div>
            </div>
          </div>
          <CampaignActions campaign={c} />
        </div>
        {c.status === 'SCHEDULED' && c.scheduleAt ? (
          <div className="flex items-start gap-2 rounded-md bg-status-info-bg p-3 text-status-info-fg">
            <CalendarDays aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium">{formatInZone(c.scheduleAt, c.timezone)}</p>
              <p className="text-xs">{c.timezone} · Audience prepared at launch</p>
            </div>
          </div>
        ) : (
          <CampaignResults campaign={c} />
        )}
        {pause && c.status === 'PAUSED' && (!c.pauseReason || c.pauseReason === 'MANUAL') ? (
          <p className="text-sm text-fg-secondary">{pause}</p>
        ) : pause ? (
          <Alert
            tone={c.status === 'PAUSED_INSUFFICIENT_FUNDS' ? 'danger' : 'warning'}
            title="Needs attention"
          >
            {pause}
            {c.status === 'PAUSED_INSUFFICIENT_FUNDS' && can('billing.read') ? (
              <Link
                href="/billing/wallet"
                className={cn('ml-1 underline underline-offset-4', focusRing)}
              >
                Open wallet
              </Link>
            ) : null}
          </Alert>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle pt-3">
          <span className="flex min-w-0 items-center gap-1.5 break-words text-xs text-fg-secondary">
            <FileText aria-hidden="true" className="size-4 shrink-0" />
            <span>
              {c.template
                ? `${c.status === 'SCHEDULED' ? 'Scheduled via' : 'Sent via'} ${c.template.name} template`
                : 'Message not frozen'}
            </span>
          </span>
          <Button variant="link" size="sm" asChild>
            <Link href={`/campaigns/${c.id}`}>
              {c.status === 'SCHEDULED' ? 'View schedule' : 'View campaign'}
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

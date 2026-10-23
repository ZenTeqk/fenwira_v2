'use client'

import { type WhatsAppConnection } from '@fenwira/contracts'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownSeparator,
  DropdownTrigger,
  StatusBadge,
} from '@fenwira/ui'
import { MoreHorizontal, RefreshCw, Star } from 'lucide-react'
import { type ReactNode } from 'react'
import { relativeTime } from '@/lib/relative-time'
import { ConnectionSteps } from './steps'

export type ConnectionAction =
  'test' | 'sync' | 'retry' | 'rename' | 'default' | 'rotate' | 'disconnect'

/** "TIER_1K" → "Up to 1K customers / 24 h" (Meta's business-initiated limit). */
function tierLabel(tier: string | null): string {
  if (!tier) return 'Not reported yet'
  const value = tier.replace(/^TIER_/, '')
  return value === 'UNLIMITED' ? 'Unlimited' : `Up to ${value} customers / 24 h`
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-base text-slate">{children}</dd>
    </div>
  )
}

export function ConnectionCard({
  connection: c,
  canManage,
  managed = false,
  busy,
  onAction,
}: {
  connection: WhatsAppConnection
  canManage: boolean
  /** ADR-0027 Managed Launch Mode: Fenwira support owns the Meta connection (sync, retry, token, disconnect). */
  managed?: boolean
  busy?: ConnectionAction
  onAction: (action: ConnectionAction) => void
}) {
  const failed = c.steps.some((s) => s.status === 'FAILED')
  const name = c.label ? `${c.label} · ${c.displayPhoneNumber}` : c.displayPhoneNumber
  return (
    <Card role="region" aria-label={`WhatsApp number ${c.displayPhoneNumber}`}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-lg font-semibold text-slate">{name}</h2>
          <p className="text-sm text-muted">
            {c.verifiedName} · {c.waba.name}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {c.isDefault ? (
            <Badge tone="info" icon={<Star />}>
              Default
            </Badge>
          ) : null}
          <StatusBadge status={c.status} />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {c.credential?.status === 'INVALID' ? (
          <Alert tone="danger" title="Meta rejected this number's token">
            {managed
              ? "Messages can't be sent until Fenwira support updates the connection. Contact support."
              : "Messages can't be sent until the token is rotated or the number is connected again."}
          </Alert>
        ) : null}
        {c.credential?.status === 'EXPIRING' && c.credential.expiresAt ? (
          <Alert tone="warning" title="The token expires soon">
            It expires {relativeTime(c.credential.expiresAt)}.{' '}
            {managed ? 'Contact Fenwira support to renew it.' : 'Rotate it to avoid interruptions.'}
          </Alert>
        ) : null}
        {failed ? (
          <Alert
            tone="danger"
            title="Setup didn't finish"
            action={
              canManage && !managed ? (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={busy === 'retry'}
                  onClick={() => onAction('retry')}
                >
                  Retry
                </Button>
              ) : null
            }
          >
            <ConnectionSteps steps={c.steps} />
          </Alert>
        ) : null}
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="Quality">
            <StatusBadge status={c.qualityRating} />
          </Detail>
          <Detail label="Messaging limit">{tierLabel(c.messagingLimitTier)}</Detail>
          <Detail label="Webhooks">
            {c.webhookStatus === 'ACTIVE' || c.webhookStatus === 'FAILED' ? (
              <StatusBadge
                status={c.webhookStatus}
                label={c.webhookStatus === 'ACTIVE' ? 'Subscribed' : 'Failed'}
              />
            ) : (
              'Not subscribed'
            )}
          </Detail>
          <Detail label="Access token">
            {c.credential ? (
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm">{c.credential.maskedToken}</span>
                <StatusBadge status={c.credential.status} />
              </span>
            ) : (
              'None'
            )}
          </Detail>
          <Detail label="Last sync">
            {c.lastSyncedAt ? (
              <time dateTime={c.lastSyncedAt} title={new Date(c.lastSyncedAt).toLocaleString()}>
                {relativeTime(c.lastSyncedAt)}
              </time>
            ) : (
              'Never'
            )}
          </Detail>
          <Detail label="Phone number ID">
            <span className="font-mono text-sm">{c.phoneNumberId}</span>
          </Detail>
        </dl>
      </CardContent>
      {canManage ? (
        <CardFooter className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => onAction('test')}>
            Test connection
          </Button>
          {managed ? null : (
            <Button
              variant="secondary"
              size="sm"
              loading={busy === 'sync'}
              onClick={() => onAction('sync')}
            >
              <RefreshCw aria-hidden="true" />
              Sync now
            </Button>
          )}
          <Dropdown>
            <DropdownTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Manage ${c.displayPhoneNumber}`}>
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownTrigger>
            <DropdownContent>
              <DropdownItem onSelect={() => onAction('rename')}>Rename</DropdownItem>
              {c.isDefault ? null : (
                <DropdownItem onSelect={() => onAction('default')}>Make default</DropdownItem>
              )}
              {managed ? null : (
                <>
                  <DropdownItem onSelect={() => onAction('rotate')}>Rotate token</DropdownItem>
                  <DropdownSeparator />
                  <DropdownItem destructive onSelect={() => onAction('disconnect')}>
                    Disconnect
                  </DropdownItem>
                </>
              )}
            </DropdownContent>
          </Dropdown>
        </CardFooter>
      ) : null}
    </Card>
  )
}

'use client'

import { type Contact } from '@fenwira/contracts'
import { DetailDrawer, Skeleton, StatusBadge } from '@fenwira/ui'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useSession } from '@/components/session/session-provider'
import { get } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { SOURCE_LABEL } from '@/lib/contacts'
import { relativeTime } from '@/lib/relative-time'
import { ConsentBadge } from './consent-badge'
import { EligibilitySummary } from './eligibility-summary'
import { TagBadges } from './tag-badges'

/** Quick inspection from the contacts list; the full profile is one click away (UX_PATTERNS → Drawers). */
export function ContactPreview({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { tenantId } = useSession()
  const q = useQuery({
    queryKey: keys.tenant(tenantId, 'contacts', id ?? 'none', 'detail'),
    queryFn: () => get<{ data: Contact }>(`/contacts/${id}`).then((r) => r.data),
    enabled: !!id,
  })
  const c = q.data
  const name = c ? (c.name ?? c.waProfileName ?? c.phoneE164) : 'Contact'
  return (
    <DetailDrawer
      open={!!id}
      onOpenChange={(o) => !o && onClose()}
      title={name}
      description={c?.phoneE164}
      fullHref={id ? `/contacts/${id}` : undefined}
      fullLabel="Open full profile"
      linkAs={Link}
    >
      {!c ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <dt className="text-secondary">Status</dt>
            <dd>
              <StatusBadge
                status={c.status === 'BLOCKED' ? 'RESTRICTED' : 'ACTIVE'}
                label={c.status === 'BLOCKED' ? 'Blocked' : 'Active'}
              />
            </dd>
            <dt className="text-secondary">Source</dt>
            <dd className="text-slate">{SOURCE_LABEL[c.source] ?? c.source}</dd>
            <dt className="text-secondary">Last message</dt>
            <dd className="text-slate">
              {c.lastInboundAt ? relativeTime(c.lastInboundAt) : 'Never'}
            </dd>
            <dt className="text-secondary">Marketing consent</dt>
            <dd>
              <ConsentBadge state={c.marketingConsent} />
            </dd>
            <dt className="text-secondary">Utility consent</dt>
            <dd>
              <ConsentBadge state={c.utilityConsent} />
            </dd>
            <dt className="text-secondary">Tags</dt>
            <dd>
              <TagBadges tags={c.tags} max={6} />
            </dd>
          </dl>
          <div className="flex flex-col gap-2">
            <h3 className="text-md font-semibold text-slate">What you can send</h3>
            <EligibilitySummary contactId={c.id} />
          </div>
        </>
      )}
    </DetailDrawer>
  )
}

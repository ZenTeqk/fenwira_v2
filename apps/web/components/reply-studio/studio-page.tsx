'use client'
import { Button, ListPage, PermissionState } from '@fenwira/ui'
import Link from 'next/link'
import { BarChart3, Plus, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { AutomationNavigation } from '@/components/automation-list/navigation'
import { FlowCollection } from '@/components/automation-list/flow-collection'
import { ReplyOverview, BusinessHoursAction } from './overview'
import { ReplyStarterCards } from './starter-cards'
import { useSession } from '@/components/session/session-provider'
import { useFlows } from '@/lib/automation'
export function ReplyStudioPage({ kind }: { kind: 'AUTO_REPLY' | 'BOT_FLOW' }) {
  const [archived, setArchived] = useState(false)
  const { can } = useSession(),
    flows = useFlows(archived)
  if (!can('automations.read')) return <PermissionState what="Reply Studio" />
  const managed = (flows.data ?? []).filter(
    (f) => f.managedBy === 'REPLY_STUDIO' && f.replyStudioKind === kind,
  )
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ListPage
        header={{
          title: 'Reply Studio',
          descriptionFullWidth: true,
          breadcrumbs: [{ label: 'Automations' }, { label: 'Reply Studio' }],
          linkAs: Link,
          description:
            'Answer common questions, guide customer enquiries, and connect customers with your team.',
          actions: (
            <div className="flex flex-wrap items-center gap-4">
              <BusinessHoursAction />
              <Button asChild variant="secondary">
                <Link href="/automations/reply-studio/reports">
                  <BarChart3 aria-hidden="true" />
                  Reports
                </Link>
              </Button>
              {can('automations.write') ? (
                <Button asChild>
                  <Link href={`/automations/reply-studio/new?kind=${kind}`}>
                    <Plus aria-hidden="true" />
                    {kind === 'AUTO_REPLY' ? 'Create auto reply' : 'Create bot flow'}
                  </Link>
                </Button>
              ) : null}
            </div>
          ),
        }}
        className="gap-4"
      >
        {!flows.isPending && !flows.isError && !managed.length ? (
          <p className="text-sm text-fg-muted">Activity will appear after your first reply runs.</p>
        ) : (
          <ReplyOverview liveCount={managed.filter((f) => f.status === 'ACTIVE').length} />
        )}
        <div className="flex min-w-0 items-end justify-between gap-2">
          <AutomationNavigation
            active={kind}
            counts={{
              AUTO_REPLY: (flows.data ?? []).filter(
                (f) => f.managedBy === 'REPLY_STUDIO' && f.replyStudioKind === 'AUTO_REPLY',
              ).length,
              BOT_FLOW: (flows.data ?? []).filter(
                (f) => f.managedBy === 'REPLY_STUDIO' && f.replyStudioKind === 'BOT_FLOW',
              ).length,
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={archived}
            onClick={() => setArchived(!archived)}
          >
            {archived ? 'Back to current items' : 'Archived items'}
          </Button>
        </div>
        <FlowCollection
          studio
          flows={managed}
          loading={flows.isPending}
          error={flows.isError}
          retry={() => void flows.refetch()}
          empty={
            archived ? (
              <p className="text-sm text-fg-secondary">No archived items</p>
            ) : can('automations.write') ? (
              <ReplyStarterCards kind={kind} />
            ) : undefined
          }
        />
        {!archived && managed.length > 0 && can('automations.write') ? (
          <ReplyStarterCards kind={kind} populated />
        ) : null}
        <p className="flex items-center gap-2 border-t border-border-subtle pt-3 text-xs text-fg-muted">
          <ShieldCheck aria-hidden="true" className="size-4" />
          Replies pause when a teammate takes over.
        </p>
      </ListPage>
    </div>
  )
}

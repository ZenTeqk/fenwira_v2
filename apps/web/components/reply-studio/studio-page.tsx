'use client'
import { Breadcrumb, Button, ListPage, PermissionState } from '@fenwira/ui'
import Link from 'next/link'
import { AutomationNavigation } from '@/components/automation-list/navigation'
import { FlowCollection } from '@/components/automation-list/flow-collection'
import { ReplyOverview, BusinessHoursAction } from './overview'
import { ReplyStarterCards } from './starter-cards'
import { useSession } from '@/components/session/session-provider'
import { useFlows } from '@/lib/automation'
export function ReplyStudioPage({ kind }: { kind: 'AUTO_REPLY' | 'BOT_FLOW' }) {
  const { can } = useSession(),
    flows = useFlows()
  if (!can('automations.read')) return <PermissionState what="Reply Studio" />
  const managed = (flows.data ?? []).filter(
    (f) => f.managedBy === 'REPLY_STUDIO' && f.replyStudioKind === kind,
  )
  const title = kind === 'AUTO_REPLY' ? 'Auto Replies' : 'Bot Flows'
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Breadcrumb
        className="md:hidden"
        items={[
          { label: 'Automations', href: '/automations/workflows' },
          { label: 'Reply Studio' },
          { label: title },
        ]}
        linkAs={Link}
      />
      <ListPage
        header={{
          title: 'Reply Studio',
          description:
            'Answer common questions, guide customer enquiries, and connect customers with your team.',
          actions: (
            <div className="flex flex-wrap items-center gap-4">
              <BusinessHoursAction />
              {can('automations.write') ? (
                <Button asChild>
                  <Link href={`/automations/reply-studio/new?kind=${kind}`}>
                    {kind === 'AUTO_REPLY' ? 'Create auto reply' : 'Create bot flow'}
                  </Link>
                </Button>
              ) : null}
            </div>
          ),
        }}
      >
        <AutomationNavigation active={kind} />
        <ReplyOverview />
        <FlowCollection
          studio
          flows={managed}
          loading={flows.isPending}
          error={flows.isError}
          retry={() => void flows.refetch()}
          empty={can('automations.write') ? <ReplyStarterCards kind={kind} /> : undefined}
        />
      </ListPage>
    </div>
  )
}

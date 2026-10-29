'use client'
import {
  Breadcrumb,
  ListPage,
  PermissionState,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@fenwira/ui'
import Link from 'next/link'
import { useState } from 'react'
import { AutomationNavigation } from '@/components/automation-list/navigation'
import { FlowCollection } from '@/components/automation-list/flow-collection'
import { CreateReplyChoice } from '@/components/reply-studio/create-choice'
import { ReplyOverview } from '@/components/reply-studio/overview'
import { ReplyStarterCards } from '@/components/reply-studio/starter-cards'
import { useSession } from '@/components/session/session-provider'
import { useFlows } from '@/lib/automation'
export default function ReplyStudioPage() {
  const { can } = useSession(),
    flows = useFlows(),
    [tab, setTab] = useState('AUTO_REPLY')
  if (!can('automations.read')) return <PermissionState what="Reply Studio" />
  const managed = (flows.data ?? []).filter((f) => f.managedBy === 'REPLY_STUDIO')
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Breadcrumb
        className="md:hidden"
        items={[{ label: 'Automations', href: '/automations' }, { label: 'Reply Studio' }]}
        linkAs={Link}
      />
      <ListPage
        header={{
          title: 'Reply Studio',
          description:
            'Answer common questions, guide customer enquiries, and connect customers with your team.',
          actions: can('automations.write') ? <CreateReplyChoice /> : null,
        }}
      >
        <AutomationNavigation studio />
        <ReplyOverview />
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList
            aria-label="Reply Studio type"
            className="w-fit max-w-full gap-2 rounded-lg border border-border bg-neutral-soft p-1"
          >
            {[
              { id: 'AUTO_REPLY', label: 'Auto Replies' },
              { id: 'BOT_FLOW', label: 'Bot Flows' },
            ].map((t) => (
              <TabsTrigger
                key={t.id}
                aria-label={t.label}
                value={t.id}
                className={`m-0 rounded-md border-0 px-4 py-2 text-sm ${tab === t.id ? 'bg-surface text-slate shadow-raised' : 'text-secondary'}`}
              >
                {t.label}
                <span className="text-xs text-muted">
                  {managed.filter((f) => f.replyStudioKind === t.id).length}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
          {(['AUTO_REPLY', 'BOT_FLOW'] as const).map((kind) => (
            <TabsContent key={kind} value={kind}>
              <FlowCollection
                studio
                flows={managed.filter((f) => f.replyStudioKind === kind)}
                loading={flows.isPending}
                error={flows.isError}
                retry={() => void flows.refetch()}
                empty={can('automations.write') ? <ReplyStarterCards kind={kind} /> : undefined}
              />
            </TabsContent>
          ))}
        </Tabs>
      </ListPage>
    </div>
  )
}

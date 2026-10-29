'use client'
import { Button, EmptyState, ListPage, PermissionState } from '@fenwira/ui'
import { Plus } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { FlowCollection } from '@/components/automation-list/flow-collection'
import { AutomationNavigation } from '@/components/automation-list/navigation'
import { StartWith } from '@/components/automation-list/start-with'
import { useSession } from '@/components/session/session-provider'
import { useFlows } from '@/lib/automation'

export default function AutomationsPage() {
  const [archived, setArchived] = useState(false)
  const { can } = useSession(),
    flows = useFlows(archived)
  if (!can('automations.read')) return <PermissionState what="automations" />
  return (
    <ListPage
      header={{
        title: 'Workflows',
        description: 'Keep conversations moving. Reply, guide and hand over the routine work.',
        actions: can('automations.write') ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" aria-pressed={archived} onClick={() => setArchived(!archived)}>
              {archived ? 'Current workflows' : 'Archived workflows'}
            </Button>
            <Button asChild>
              <Link href="/automations/new">
                <Plus aria-hidden="true" />
                Create workflow
              </Link>
            </Button>
          </div>
        ) : null,
      }}
    >
      <AutomationNavigation />
      {!archived && can('automations.write') ? <StartWith /> : null}
      <FlowCollection
        flows={flows.data ?? []}
        loading={flows.isPending}
        error={flows.isError}
        retry={() => void flows.refetch()}
        empty={
          archived ? (
            <EmptyState
              title="No archived workflows"
              description="Archived workflows can be restored here without turning them on."
            />
          ) : undefined
        }
      />
    </ListPage>
  )
}

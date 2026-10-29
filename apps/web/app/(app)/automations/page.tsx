'use client'
import { Button, ListPage, PermissionState } from '@fenwira/ui'
import { Plus } from 'lucide-react'
import Link from 'next/link'
import { FlowCollection } from '@/components/automation-list/flow-collection'
import { AutomationNavigation } from '@/components/automation-list/navigation'
import { StartWith } from '@/components/automation-list/start-with'
import { useSession } from '@/components/session/session-provider'
import { useFlows } from '@/lib/automation'

export default function AutomationsPage() {
  const { can } = useSession(),
    flows = useFlows()
  if (!can('automations.read')) return <PermissionState what="automations" />
  return (
    <ListPage
      header={{
        title: 'Automations',
        description: 'Keep conversations moving. Reply, guide and hand over the routine work.',
        actions: can('automations.write') ? (
          <Button asChild>
            <Link href="/automations/new">
              <Plus aria-hidden="true" />
              Create automation
            </Link>
          </Button>
        ) : null,
      }}
    >
      <AutomationNavigation />
      {can('automations.write') ? <StartWith /> : null}
      <FlowCollection
        flows={flows.data ?? []}
        loading={flows.isPending}
        error={flows.isError}
        retry={() => void flows.refetch()}
      />
    </ListPage>
  )
}

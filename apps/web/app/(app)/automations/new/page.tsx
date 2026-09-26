'use client'

import { PageHeader } from '@fenwira/ui'
import Link from 'next/link'
import { CreateFlowForm } from '@/components/automation/create-flow-form'
import { useSession } from '@/components/session/session-provider'
import { NoAccess } from '@/components/settings/no-access'

export default function NewAutomationPage() {
  const { can } = useSession()
  if (!can('automations.write')) return <NoAccess what="automations" />
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="New automation"
        breadcrumbs={[{ label: 'Automations', href: '/automations' }, { label: 'New' }]}
        linkAs={Link}
        description="Reply, tag, assign or call your systems automatically when something happens."
      />
      <CreateFlowForm />
    </div>
  )
}

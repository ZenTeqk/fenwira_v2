'use client'

import { PageHeader, PermissionState } from '@fenwira/ui'
import { CreateFlowForm } from '@/components/automation/create-flow-form'
import { useSession } from '@/components/session/session-provider'

export default function NewAutomationPage() {
  const { can } = useSession()
  if (!can('automations.write')) return <PermissionState what="automations" />
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="New automation"
        description="Reply, tag, assign or call your systems automatically when something happens."
      />
      <CreateFlowForm />
    </div>
  )
}

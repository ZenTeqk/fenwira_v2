'use client'

import { PermissionState } from '@fenwira/ui'
import { useParams } from 'next/navigation'
import { FlowBuilder } from '@/components/automation/flow-builder'
import { useSession } from '@/components/session/session-provider'

export default function AutomationBuilderPage() {
  const { id } = useParams<{ id: string }>()
  const { can } = useSession()
  if (!can('automations.read')) return <PermissionState what="automations" />
  return <FlowBuilder flowId={id} />
}

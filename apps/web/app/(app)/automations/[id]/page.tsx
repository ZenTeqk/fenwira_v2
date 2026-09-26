'use client'

import { useParams } from 'next/navigation'
import { FlowBuilder } from '@/components/automation/flow-builder'
import { useSession } from '@/components/session/session-provider'
import { NoAccess } from '@/components/settings/no-access'

export default function AutomationBuilderPage() {
  const { id } = useParams<{ id: string }>()
  const { can } = useSession()
  if (!can('automations.read')) return <NoAccess what="automations" />
  return <FlowBuilder flowId={id} />
}

import { EmptyState } from '@fenwira/ui'
import { Lock } from 'lucide-react'

export function NoAccess({ what }: { what: string }) {
  return (
    <EmptyState
      icon={<Lock aria-hidden="true" />}
      title="You don't have access"
      description={`Your role in this workspace can't view ${what}. Ask a workspace admin if you need it.`}
    />
  )
}

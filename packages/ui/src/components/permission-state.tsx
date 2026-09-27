import { Lock } from 'lucide-react'
import { EmptyState } from './states'

export type PermissionStateProps = {
  /** What the page shows, e.g. "campaigns". */
  what: string
  /** The missing permission, shown so an admin knows what to grant. */
  permission?: string
  className?: string
}

/** Shown when the member's role can't open this content (the API enforces the same). */
export function PermissionState({ what, permission, className }: PermissionStateProps) {
  return (
    <EmptyState
      className={className}
      icon={<Lock aria-hidden="true" />}
      title="You don't have access"
      description={
        <>
          Your role in this workspace can&apos;t view {what}. Ask a workspace owner or admin
          {permission ? (
            <>
              {' '}
              to grant <span className="font-mono text-sm">{permission}</span>
            </>
          ) : null}{' '}
          if you need it.
        </>
      }
    />
  )
}

'use client'
import { type Flow, type FlowVersion } from '@fenwira/contracts'
import { Button, StatusBadge } from '@fenwira/ui'
export function VersionState({
  flow,
  draft,
  dirty,
  onDiscard,
  disabled,
}: {
  flow: Flow
  draft: FlowVersion
  dirty?: boolean
  onDiscard: () => void
  disabled?: boolean
}) {
  const changes = draft.state === 'DRAFT' || dirty
  return (
    <section
      aria-label="Draft and published versions"
      className="flex flex-wrap items-center gap-4 rounded-lg border border-border-subtle bg-surface px-4 py-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        {changes ? (
          <>
            <StatusBadge status="DRAFT" label="Draft changes" />
            <span className="text-xs text-fg-secondary">
              Version {draft.version} · {new Date(draft.updatedAt).toLocaleString()}
            </span>
          </>
        ) : (
          <span className="text-sm text-fg-secondary">No draft changes</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {flow.activeVersion ? (
          <>
            <StatusBadge status="ACTIVE" label="Published version" />
            <span className="text-xs text-fg-secondary">Version {flow.activeVersion}</span>
          </>
        ) : (
          <span className="text-xs text-fg-muted">Not published yet</span>
        )}
      </div>
      {changes && flow.activeVersion ? (
        <Button variant="ghost" size="sm" disabled={disabled} onClick={onDiscard}>
          Discard draft changes
        </Button>
      ) : null}
      <p className="text-xs text-fg-muted">Running sessions keep their published version.</p>
    </section>
  )
}

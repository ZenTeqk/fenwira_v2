'use client'

import { type TemplateVersion } from '@fenwira/contracts'
import { Button } from '@fenwira/ui'
import { useTemplateSampleUrl } from '@/lib/templates'
import { TemplatePreview } from './template-preview'

/** Current stored content, including the existing signed media sample when available. */
export function TemplateMessage({
  version,
  compact = false,
}: {
  version: TemplateVersion
  compact?: boolean
}) {
  const header = version.components.header
  const sampleId = header && header.format !== 'TEXT' ? header.sampleFileId : null
  const sample = useTemplateSampleUrl(sampleId)
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <TemplatePreview
        components={version.components}
        samples={version.samples}
        headerImageUrl={sample.data}
        compact={compact}
      />
      {sample.isError ? (
        <p className="text-sm text-secondary">
          Media sample unavailable.{' '}
          <Button variant="link" size="sm" onClick={() => void sample.refetch()}>
            Retry sample
          </Button>
        </p>
      ) : null}
    </div>
  )
}

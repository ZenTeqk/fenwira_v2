'use client'

import { type TemplateVersion } from '@fenwira/contracts'
import { Button, cn } from '@fenwira/ui'
import { useTemplateSampleUrl } from '@/lib/templates'
import { TemplatePreview } from './template-preview'

/** Current stored content, including the existing signed media sample when available. */
export function TemplateMessage({
  version,
  compact = false,
  library = false,
}: {
  version: TemplateVersion
  compact?: boolean
  /** Library-only scale; editor, Inbox and Campaigns keep their approved renderer. */
  library?: boolean
}) {
  const header = version.components.header
  const sampleId = header && header.format !== 'TEXT' ? header.sampleFileId : null
  const sample = useTemplateSampleUrl(sampleId)
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-2',
        library && compact && '[&_figure>div>p]:line-clamp-4 [&_figure_img]:max-h-24',
      )}
    >
      <TemplatePreview
        components={version.components}
        samples={version.samples}
        headerImageUrl={sample.data}
        compact={compact}
        className={library ? 'max-w-none rounded-md p-2 [&_p]:text-sm [&_li]:py-1.5' : undefined}
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

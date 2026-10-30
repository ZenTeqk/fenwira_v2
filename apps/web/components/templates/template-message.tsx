'use client'

import { type TemplateVersion } from '@fenwira/contracts'
import { Button } from '@fenwira/ui'
import { useTemplateSampleUrl } from '@/lib/templates'
import { TemplatePreview } from './template-preview'
import { TemplatePhonePreview } from './template-phone-preview'

/** Current stored content, including the existing signed media sample when available. */
export function TemplateMessage({
  version,
  compact = false,
  library = false,
  businessName,
}: {
  version: TemplateVersion
  compact?: boolean
  /** Library-only scale; editor, Inbox and Campaigns keep their approved renderer. */
  library?: boolean
  businessName?: string
}) {
  const header = version.components.header
  const sampleId = header && header.format !== 'TEXT' ? header.sampleFileId : null
  const sample = useTemplateSampleUrl(sampleId)
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {!compact ? (
        <TemplatePhonePreview
          components={version.components}
          samples={version.samples}
          headerImageUrl={sample.data}
          businessName={businessName}
        />
      ) : (
        <div
          className={
            library
              ? 'fw-template-library-preview relative h-48 min-w-0 overflow-hidden rounded-lg bg-chat-canvas p-3'
              : undefined
          }
        >
          <TemplatePreview
            components={version.components}
            samples={version.samples}
            headerImageUrl={sample.data}
            compact={compact}
            library={library}
            className={library ? '[&_p]:text-sm [&_li]:py-1.5' : undefined}
          />
        </div>
      )}
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

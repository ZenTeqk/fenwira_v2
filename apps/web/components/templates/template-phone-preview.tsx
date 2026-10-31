'use client'

import { cn, PhoneFrame } from '@fenwira/ui'
import { type TemplateComponents, type VariableSamples } from '@fenwira/contracts'
import { TemplatePreview } from './template-preview'

/** All recipient previews share the same bounded, accessible conversation frame. */
export function TemplatePhonePreview({
  components,
  samples,
  headerImageUrl,
  businessName,
  compact = false,
  sticky = true,
}: {
  components: TemplateComponents
  samples: VariableSamples
  headerImageUrl?: string | null
  businessName?: string
  compact?: boolean
  /** Pin while the page scrolls. Turn off inside an already sticky panel, where a pinned phone
   * would slide over the content below it. */
  sticky?: boolean
}) {
  return (
    <div className={cn('mx-auto w-full md:max-w-sm', sticky && 'sticky top-4')}>
      <PhoneFrame contactName={businessName}>
        <span
          aria-hidden="true"
          className="self-center rounded-md bg-surface px-3 py-1 text-xs text-fg-secondary shadow-raised"
        >
          Today
        </span>
        <div className="w-full min-w-0 pr-4">
          <TemplatePreview
            components={components}
            samples={samples}
            headerImageUrl={headerImageUrl}
            recipient
          />
        </div>
      </PhoneFrame>
      <p className="mt-2 text-xs text-fg-secondary">
        {compact
          ? 'Recipient preview · layout varies by device.'
          : 'Recipient preview using sample values. Layout may vary by device. Preview controls do not send messages.'}
      </p>
    </div>
  )
}

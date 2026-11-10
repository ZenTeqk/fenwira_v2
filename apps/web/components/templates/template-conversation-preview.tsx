'use client'

import { type TemplateComponents, type VariableSamples } from '@fenwira/contracts'
import { Button, PhoneFrame } from '@fenwira/ui'
import { useTemplateSampleUrl } from '@/lib/templates'
import { TemplatePreview } from './template-preview'

/**
 * Template preview drawer phone: the shared recipient PhoneFrame on the chat-canvas stage, at the
 * stage's original size (up to 288px wide; height from `.fw-preview-stage .fw-phone-frame`).
 * Long messages scroll inside the phone's chat; its composer is decorative. Template buttons are
 * static list items and never act.
 */
export function TemplateConversationPreview({
  components,
  samples,
  businessName,
}: {
  components: TemplateComponents
  samples: VariableSamples
  businessName: string
}) {
  const header = components.header
  const sampleId = header && header.format !== 'TEXT' ? header.sampleFileId : null
  const sample = useTemplateSampleUrl(sampleId)
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <section
        aria-label="WhatsApp preview"
        className="fw-preview-stage flex min-w-0 shrink-0 justify-center rounded-xl bg-chat-canvas px-5 py-6"
      >
        <div className="w-full max-w-72">
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
                headerImageUrl={sample.data}
                recipient
              />
            </div>
          </PhoneFrame>
        </div>
      </section>
      {sample.isError ? (
        <p className="text-sm text-fg-secondary">
          Media sample unavailable.{' '}
          <Button variant="link" size="sm" onClick={() => void sample.refetch()}>
            Retry sample
          </Button>
        </p>
      ) : null}
    </div>
  )
}

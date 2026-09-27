'use client'

import { type TemplateComponents, type VariableSamples } from '@fenwira/contracts'
import { cn } from '@fenwira/ui'
import { Copy, ExternalLink, FileText, Image as ImageIcon, Phone, Reply, Video } from 'lucide-react'
import { VariableText } from './variable-text'

const MEDIA_ICON = { IMAGE: ImageIcon, VIDEO: Video, DOCUMENT: FileText } as const

/**
 * Live WhatsApp-style preview (docs/TEMPLATE_ENGINE.md → Builder UX): a phone-width chat with the
 * message bubble and its buttons. Variables show their sample values as chips.
 */
export function TemplatePreview({
  components: c,
  samples,
  headerImageUrl,
  className,
}: {
  components: TemplateComponents
  samples: VariableSamples
  headerImageUrl?: string | null
  className?: string
}) {
  const header = c.header
  const MediaIcon = header && header.format !== 'TEXT' ? MEDIA_ICON[header.format] : null
  return (
    <figure
      aria-label="Message preview"
      className={cn(
        'mx-auto flex w-full max-w-sm flex-col gap-1 rounded-xl bg-neutral-soft p-3',
        className,
      )}
    >
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-2 text-base text-slate shadow-raised">
        {header?.format === 'TEXT' && header.text ? (
          <p className="font-semibold">
            <VariableText text={header.text} values={samples.header} />
          </p>
        ) : null}
        {MediaIcon ? (
          headerImageUrl && header?.format === 'IMAGE' ? (
            // eslint-disable-next-line @next/next/no-img-element -- presigned URL, not optimizable
            <img
              src={headerImageUrl}
              alt="Header sample"
              className="aspect-video w-full rounded-md object-cover"
            />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center rounded-md bg-neutral-soft text-slate">
              <MediaIcon aria-hidden="true" className="size-8" />
              <span className="sr-only">{header?.format.toLowerCase()} header</span>
            </div>
          )
        ) : null}
        <p>
          {c.body.text ? (
            <VariableText text={c.body.text} values={samples.body} />
          ) : (
            <span className="text-muted">Your message text appears here.</span>
          )}
        </p>
        {c.auth?.securityRecommendation ? (
          <p className="text-sm">For your security, do not share this code.</p>
        ) : null}
        {c.footer?.text || c.auth?.codeExpirationMinutes ? (
          <p className="text-sm text-muted">
            {c.footer?.text ?? `This code expires in ${c.auth?.codeExpirationMinutes} minutes.`}
          </p>
        ) : null}
      </div>
      {c.buttons?.length ? (
        <ul className="flex flex-col gap-1" aria-label="Buttons">
          {c.buttons.map((b, i) => {
            const Icon =
              b.type === 'URL'
                ? ExternalLink
                : b.type === 'PHONE_NUMBER'
                  ? Phone
                  : b.type === 'COPY_CODE'
                    ? Copy
                    : Reply
            const label = b.type === 'COPY_CODE' ? 'Copy code' : b.text || 'Button'
            return (
              <li
                key={i}
                className="flex items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-info-strong"
              >
                <Icon aria-hidden="true" className="size-4" />
                {label}
              </li>
            )
          })}
        </ul>
      ) : null}
    </figure>
  )
}

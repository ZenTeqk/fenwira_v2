'use client'

import { type TemplateComponents, type VariableSamples } from '@fenwira/contracts'
import { cn } from '@fenwira/ui'
import { Copy, ExternalLink, FileText, Image as ImageIcon, Phone, Reply, Video } from 'lucide-react'
import { VariableText } from './variable-text'
import { RecipientText } from './recipient-text'

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
  compact = false,
  recipient = false,
}: {
  components: TemplateComponents
  samples: VariableSamples
  headerImageUrl?: string | null
  className?: string
  compact?: boolean
  recipient?: boolean
}) {
  const text = (value: string, values?: readonly (string | undefined)[]) =>
    recipient ? (
      <RecipientText text={value} values={values} />
    ) : (
      <VariableText text={value} values={values} />
    )
  const header = c.header
  const MediaIcon = header && header.format !== 'TEXT' ? MEDIA_ICON[header.format] : null
  return (
    <figure
      aria-label="Message preview"
      className={cn(
        'mx-auto flex w-full max-w-sm flex-col gap-1 rounded-xl bg-neutral-soft p-3',
        className,
        recipient && 'overflow-hidden rounded-lg bg-surface p-0 shadow-raised',
      )}
    >
      <div
        className={cn(
          'flex flex-col gap-2 rounded-lg border border-border bg-surface p-2 text-base text-slate shadow-raised',
          recipient && 'rounded-none border-0 p-3 shadow-none',
        )}
      >
        {header?.format === 'TEXT' && header.text ? (
          <p className="font-semibold">{text(header.text, samples.header)}</p>
        ) : null}
        {MediaIcon ? (
          headerImageUrl && header?.format === 'IMAGE' ? (
            // eslint-disable-next-line @next/next/no-img-element -- presigned URL, not optimizable
            <img
              src={headerImageUrl}
              alt="Header sample"
              className={cn(
                'aspect-video w-full rounded-md object-cover',
                compact && 'max-h-24',
                recipient && 'aspect-auto object-contain',
              )}
            />
          ) : recipient && headerImageUrl && header?.format === 'VIDEO' ? (
            <video
              controls
              preload="metadata"
              src={headerImageUrl}
              aria-label="Video header sample"
              className="w-full rounded-md"
            />
          ) : (
            <div
              className={cn(
                'flex aspect-video w-full flex-col gap-2 items-center justify-center rounded-md bg-neutral-soft text-slate',
                compact && 'max-h-24',
              )}
            >
              <MediaIcon aria-hidden="true" className="size-8" />
              <span className={recipient ? 'text-xs' : 'sr-only'}>
                {header?.format.toLowerCase()} header{recipient ? ' sample' : ''}
              </span>
            </div>
          )
        ) : null}
        <p className={compact ? 'line-clamp-4' : undefined}>
          {c.body.text ? (
            text(c.body.text, samples.body)
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
        {recipient ? (
          <span aria-hidden="true" className="self-end text-xs text-muted">
            9:41 AM
          </span>
        ) : null}
      </div>
      {c.buttons?.length ? (
        <ul className={cn('flex flex-col gap-1', recipient && 'gap-0')} aria-label="Buttons">
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
                className={cn(
                  'flex items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-info-strong',
                  recipient && 'min-h-11 rounded-none border-x-0 border-b-0 text-base',
                )}
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

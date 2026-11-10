'use client'

import {
  renderTemplateText,
  requiredVariables,
  type Template,
  type VariableSamples,
} from '@fenwira/contracts'
import { Badge, Button, Drawer, DrawerClose, DrawerContent, Field, Input } from '@fenwira/ui'
import { ChevronDown, RotateCcw } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { TemplateConversationPreview } from './template-conversation-preview'

/**
 * Template preview sheet: a right-side drawer (full width on phones) led by the recipient phone, with preview-only sample values and the existing details below. Sample edits
 * live in local state only; they are never saved, and they reset when the template changes or the
 * drawer reopens (the sheet remounts per template and unmounts on close).
 */
export function TemplateContext({
  template,
  onClose,
  restoreFocus,
  children,
}: {
  template?: Template
  onClose: () => void
  restoreFocus: () => void
  children: ReactNode
}) {
  return (
    <Drawer open={!!template} onOpenChange={(open) => !open && onClose()}>
      {template ? (
        <TemplatePreviewSheet key={template.id} template={template} restoreFocus={restoreFocus}>
          {children}
        </TemplatePreviewSheet>
      ) : null}
    </Drawer>
  )
}

type SampleField = {
  id: string
  label: string
  value: string
  placeholder: string
  hint?: string
  onChange: (value: string) => void
}

/** Copy of `list` with `value` at `index`, filling any gap with empty strings. */
function setAt(list: readonly string[] | undefined, index: number, value: string): string[] {
  return Array.from({ length: Math.max(list?.length ?? 0, index + 1) }, (_, i) =>
    i === index ? value : (list?.[i] ?? ''),
  )
}

function TemplatePreviewSheet({
  template,
  restoreFocus,
  children,
}: {
  template: Template
  restoreFocus: () => void
  children: ReactNode
}) {
  const { components, samples: initial } = template.currentVersion
  const [values, setValues] = useState<VariableSamples>(initial)
  const need = requiredVariables(components)

  const fields: Array<{ group: string; items: SampleField[] }> = []
  if (need.header)
    fields.push({
      group: 'Header',
      items: Array.from({ length: need.header }, (_, i) => ({
        id: `header-${i}`,
        label: `Header variable ${i + 1}`,
        value: values.header?.[i] ?? '',
        placeholder: `{{${i + 1}}}`,
        onChange: (v) => setValues((s) => ({ ...s, header: setAt(s.header, i, v) })),
      })),
    })
  if (need.body)
    fields.push({
      group: 'Body',
      items: Array.from({ length: need.body }, (_, i) => ({
        id: `body-${i}`,
        label: `Body variable ${i + 1}`,
        value: values.body[i] ?? '',
        placeholder: `{{${i + 1}}}`,
        onChange: (v) => setValues((s) => ({ ...s, body: setAt(s.body, i, v) })),
      })),
    })
  const buttonItems = Object.keys(need.buttons).flatMap((key) => {
    const button = components.buttons?.[Number(key)]
    if (button?.type !== 'URL') return []
    const current = values.buttons?.[key] ?? []
    return [
      {
        id: `button-${key}`,
        label: `Button variable 1${button.text ? ` · ${button.text}` : ''}`,
        value: current[0] ?? '',
        placeholder: '{{1}}',
        hint: `Link: ${renderTemplateText(button.url, current)}`,
        onChange: (v: string) =>
          setValues((s) => ({
            ...s,
            buttons: { ...s.buttons, [key]: setAt(s.buttons?.[key], 0, v) },
          })),
      },
    ]
  })
  if (buttonItems.length) fields.push({ group: 'Buttons', items: buttonItems })
  const hasFields = fields.length > 0

  return (
    <DrawerContent
      title={template.name}
      description="How customers see this template on WhatsApp"
      // 460px on desktop (w-full caps it at the viewport); full width on phones.
      className="max-w-115"
      onCloseAutoFocus={(event) => {
        event.preventDefault()
        restoreFocus()
      }}
      footer={
        <DrawerClose asChild>
          <Button type="button" size="sm">
            Done
          </Button>
        </DrawerClose>
      }
    >
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <TemplateConversationPreview
            components={components}
            samples={values}
            businessName={template.wabaName}
          />
          <p className="text-center text-xs text-fg-secondary">
            Sample preview. Appearance may vary by device.
          </p>
        </div>

        <details className="group rounded-lg border border-border-subtle bg-surface">
          <summary className="fw-summary flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring">
            <span className="flex flex-wrap items-center gap-2">
              Sample values
              <Badge tone="neutral" className="rounded-full font-normal">
                For preview only
              </Badge>
            </span>
            <ChevronDown
              aria-hidden="true"
              className="size-4 shrink-0 text-fg-secondary transition-transform group-open:rotate-180 motion-reduce:transition-none"
            />
          </summary>
          <div className="flex flex-col gap-4 border-t border-border-subtle px-3 pt-3 pb-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-fg-muted">Changes here only update this preview.</p>
              {hasFields ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="shrink-0"
                  onClick={() => setValues(initial)}
                >
                  <RotateCcw aria-hidden="true" />
                  Reset values
                </Button>
              ) : null}
            </div>
            {hasFields ? (
              fields.map(({ group, items }) => (
                <fieldset key={group} className="flex min-w-0 flex-col gap-3">
                  <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-secondary">
                    {group}
                  </legend>
                  {items.map((f) => (
                    <Field key={f.id} label={f.label} hint={f.hint} className="break-words">
                      <Input
                        value={f.value}
                        placeholder={f.placeholder}
                        autoComplete="off"
                        onChange={(event) => f.onChange(event.target.value)}
                      />
                    </Field>
                  ))}
                </fieldset>
              ))
            ) : (
              <p className="text-sm text-fg-secondary">This template has no variables.</p>
            )}
          </div>
        </details>

        <div className="flex min-w-0 flex-col gap-4 border-t border-border-subtle pt-3">
          {children}
        </div>
      </div>
    </DrawerContent>
  )
}

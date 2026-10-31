'use client'

import {
  type ApprovedTemplate,
  missingVariables,
  requiredVariables,
  type TemplateVariables,
} from '@fenwira/contracts'
import {
  Button,
  Field,
  Input,
  Modal,
  ModalClose,
  ModalContent,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@fenwira/ui'
import { useId, useMemo, useState } from 'react'
import { TemplatePhonePreview } from '@/components/templates/template-phone-preview'
import { CATEGORY_LABEL, languageLabel, useApprovedTemplates } from '@/lib/templates'

export type TemplateSend = {
  content: { type: 'TEMPLATE'; templateVersionId: string; variables: TemplateVariables }
  /** What the thread shows until the server's message arrives. */
  display: { type: 'TEMPLATE'; name: string; language: string }
}

/**
 * Inbox template picker (docs/INBOX.md, docs/TEMPLATE_ENGINE.md → Rendering and sending): an
 * approved template of this conversation's number, every variable filled in, with a live preview.
 */
export function TemplatePicker({
  phoneNumberId,
  open,
  onOpenChange,
  onSend,
  sending,
}: {
  phoneNumberId: string
  open: boolean
  onOpenChange: (o: boolean) => void
  onSend: (t: TemplateSend) => void
  sending: boolean
}) {
  const templates = useApprovedTemplates(phoneNumberId, open)
  const [versionId, setVersionId] = useState('')
  const [values, setValues] = useState<TemplateVariables>({ body: [] })
  const selectId = useId()
  const chosen: ApprovedTemplate | undefined = templates.data?.find(
    (t) => t.versionId === versionId,
  )
  const need = chosen ? requiredVariables(chosen.components) : null
  const missing = useMemo(
    () =>
      chosen
        ? chosen.category === 'AUTHENTICATION'
          ? values.body[0]?.trim()
            ? []
            : ['body.0']
          : missingVariables(chosen.components, values)
        : ['template'],
    [chosen, values],
  )
  const setPart = (part: 'header' | 'body', i: number, v: string) =>
    setValues((x) => {
      const arr = [...(x[part] ?? [])]
      arr[i] = v
      return { ...x, [part]: arr }
    })
  const pick = (id: string) => {
    setVersionId(id)
    setValues({ body: [] })
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent
        title="Send a template"
        description="Approved templates can be sent at any time, including after the 24-hour window."
        footer={
          <>
            <ModalClose asChild>
              <Button variant="secondary">Cancel</Button>
            </ModalClose>
            <Button
              loading={sending}
              disabled={!chosen || missing.length > 0}
              onClick={() =>
                chosen &&
                onSend({
                  content: {
                    type: 'TEMPLATE',
                    templateVersionId: chosen.versionId,
                    variables: values,
                  },
                  display: { type: 'TEMPLATE', name: chosen.name, language: chosen.language },
                })
              }
            >
              Send template
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span id={selectId} className="text-sm font-medium text-fg">
              Template
            </span>
            <Select value={versionId} onValueChange={pick}>
              <SelectTrigger aria-labelledby={selectId}>
                <SelectValue placeholder={templates.isPending ? 'Loading…' : 'Choose a template'} />
              </SelectTrigger>
              <SelectContent>
                {(templates.data ?? []).map((t) => (
                  <SelectItem key={t.versionId} value={t.versionId}>
                    {t.name} · {languageLabel(t.language)} · {CATEGORY_LABEL[t.category]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {templates.data && !templates.data.length ? (
              <p className="text-sm text-fg-muted">
                No approved templates for this number yet. Create one in Templates.
              </p>
            ) : null}
          </div>
          {chosen && need ? (
            <>
              {chosen.category === 'AUTHENTICATION' ? (
                <Field label="Code">
                  <Input
                    value={values.body[0] ?? ''}
                    onChange={(e) => setPart('body', 0, e.target.value)}
                  />
                </Field>
              ) : (
                <>
                  {Array.from({ length: need.header }, (_, i) => (
                    <Field key={`h${i}`} label={`Header {{${i + 1}}}`}>
                      <Input
                        value={values.header?.[i] ?? ''}
                        placeholder={chosen.samples.header?.[i]}
                        onChange={(e) => setPart('header', i, e.target.value)}
                      />
                    </Field>
                  ))}
                  {Array.from({ length: need.body }, (_, i) => (
                    <Field key={`b${i}`} label={`Message {{${i + 1}}}`}>
                      <Input
                        value={values.body[i] ?? ''}
                        placeholder={chosen.samples.body[i]}
                        onChange={(e) => setPart('body', i, e.target.value)}
                      />
                    </Field>
                  ))}
                  {Object.keys(need.buttons).map((idx) => (
                    <Field key={`u${idx}`} label={`Website button ${Number(idx) + 1} {{1}}`}>
                      <Input
                        value={values.buttons?.[idx]?.[0] ?? ''}
                        placeholder={chosen.samples.buttons?.[idx]?.[0]}
                        onChange={(e) =>
                          setValues((x) => ({
                            ...x,
                            buttons: { ...x.buttons, [idx]: [e.target.value] },
                          }))
                        }
                      />
                    </Field>
                  ))}
                  {need.headerMedia ? (
                    <p className="text-sm text-fg-muted">
                      The header uses the template’s sample {need.headerMedia.toLowerCase()}.
                    </p>
                  ) : null}
                </>
              )}
              <TemplatePhonePreview
                components={chosen.components}
                samples={{
                  header: values.header,
                  body: values.body,
                  buttons: values.buttons,
                }}
              />
            </>
          ) : null}
        </div>
      </ModalContent>
    </Modal>
  )
}

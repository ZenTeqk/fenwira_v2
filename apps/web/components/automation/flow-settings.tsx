'use client'

import { replyStudioSettingsSchema, type DraftGraph, type Flow } from '@fenwira/contracts'
import {
  Alert,
  Textarea,
  Button,
  Field,
  Input,
  Label,
  Modal,
  ModalContent,
  RadioGroup,
  RadioGroupItem,
  toast,
} from '@fenwira/ui'
import { useMutation } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { ApiError, patch } from '@/lib/api/client'
import { PRIORITY_HINT, REENTRY_OPTIONS } from '@/lib/automation'

/** Name, priority and when the automation may start again (re-entry), in plain language. */
export function FlowSettings({
  flow,
  replyStudio,
  onReplyStudioSave,
  open,
  onOpenChange,
  onSaved,
}: {
  flow: Flow
  replyStudio?: DraftGraph['replyStudio']
  onReplyStudioSave?: (settings: NonNullable<DraftGraph['replyStudio']>) => Promise<void>
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const ids = useId()
  const [sessionSettings, setSessionSettings] = useState(replyStudio)
  const [name, setName] = useState(flow.name)
  const [priority, setPriority] = useState(String(flow.priority))
  const [reentry, setReentry] = useState(flow.reentryPolicy)
  const [errors, setErrors] = useState<{ name?: string; priority?: string }>({})
  const save = useMutation({
    mutationFn: async () => {
      if (sessionSettings && onReplyStudioSave) {
        const parsed = replyStudioSettingsSchema.safeParse(sessionSettings)
        if (!parsed.success)
          throw new Error(
            `Session settings: ${parsed.error.issues[0]?.message ?? 'Check the values.'}`,
          )
        await onReplyStudioSave(parsed.data)
      }
      return patch(`/flows/${flow.id}`, {
        name: name.trim(),
        priority: Number(priority),
        reentryPolicy: reentry,
      })
    },
    onSuccess: () => {
      toast.success('Settings saved.')
      onSaved()
      onOpenChange(false)
    },
    onError: (e) => {
      if (e instanceof ApiError && (e.field('name') || e.field('priority')))
        setErrors({ name: e.field('name'), priority: e.field('priority') })
      else toast.error(e instanceof Error ? e.message : 'Could not save the settings.')
    },
  })
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent
        title="Automation settings"
        description={
          replyStudio
            ? 'Session changes become live when you publish. Name, priority and re-entry apply immediately.'
            : 'These apply to every version of this automation.'
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" form={`${ids}-form`} loading={save.isPending}>
              Save settings
            </Button>
          </>
        }
      >
        <form
          id={`${ids}-form`}
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault()
            const next: typeof errors = {}
            if (!name.trim()) next.name = 'Give the automation a name.'
            if (!/^\d+$/.test(priority)) next.priority = 'Enter a whole number, 0 or more.'
            setErrors(next)
            if (!next.name && !next.priority) save.mutate()
          }}
        >
          <Field label="Name" error={errors.name} required>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </Field>
          <details>
            <summary className="text-sm font-semibold text-fg">Advanced settings</summary>
            <div className="mt-4 flex flex-col gap-4">
              <Field label="Priority" hint={PRIORITY_HINT} error={errors.priority}>
                <Input
                  type="number"
                  min={0}
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className="w-32"
                />
              </Field>
              {sessionSettings ? (
                <section className="flex flex-col gap-4">
                  <h3 className="text-md font-semibold text-fg">Reply Studio session settings</h3>
                  <Alert tone="info" title="Publish these changes">
                    Running conversations keep the settings from their original published version.
                  </Alert>
                  <Field label="Restart words" hint="Separate phrases with commas.">
                    <Input
                      value={sessionSettings.restartWords.join(', ')}
                      onChange={(e) =>
                        setSessionSettings({
                          ...sessionSettings,
                          restartWords: e.target.value.split(',').map((s) => s.trim()),
                        })
                      }
                    />
                  </Field>
                  <Field
                    label="Inactivity expiry (minutes)"
                    hint="Up to 1440 minutes, capped by the WhatsApp reply window."
                  >
                    <Input
                      type="number"
                      min={1}
                      max={1440}
                      value={sessionSettings.expiryMinutes}
                      onChange={(e) =>
                        setSessionSettings({
                          ...sessionSettings,
                          expiryMinutes: Number(e.target.value),
                        })
                      }
                    />
                  </Field>
                  <Field label="Fallback message">
                    <Textarea
                      value={sessionSettings.fallbackMessage}
                      onChange={(e) =>
                        setSessionSettings({ ...sessionSettings, fallbackMessage: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Optional closing message">
                    <Textarea
                      value={sessionSettings.closingMessage}
                      onChange={(e) =>
                        setSessionSettings({ ...sessionSettings, closingMessage: e.target.value })
                      }
                    />
                  </Field>
                </section>
              ) : null}
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-medium text-fg">
                  Can it start again for the same person?
                </legend>
                <RadioGroup
                  value={reentry}
                  onValueChange={(v) => setReentry(v as Flow['reentryPolicy'])}
                  className="flex flex-col gap-3"
                >
                  {REENTRY_OPTIONS.map((o) => (
                    <div key={o.value} className="flex items-start gap-2">
                      <RadioGroupItem
                        id={`${ids}-${o.value}`}
                        value={o.value}
                        className="mt-0.5"
                        aria-describedby={`${ids}-${o.value}-hint`}
                      />
                      <span className="flex flex-col">
                        <Label htmlFor={`${ids}-${o.value}`}>{o.label}</Label>
                        <span id={`${ids}-${o.value}-hint`} className="text-sm text-fg-secondary">
                          {o.hint}
                        </span>
                      </span>
                    </div>
                  ))}
                </RadioGroup>
              </fieldset>
            </div>
          </details>
        </form>
      </ModalContent>
    </Modal>
  )
}

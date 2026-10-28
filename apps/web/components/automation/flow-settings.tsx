'use client'

import { type Flow } from '@fenwira/contracts'
import {
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
  open,
  onOpenChange,
  onSaved,
}: {
  flow: Flow
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const ids = useId()
  const [name, setName] = useState(flow.name)
  const [priority, setPriority] = useState(String(flow.priority))
  const [reentry, setReentry] = useState(flow.reentryPolicy)
  const [errors, setErrors] = useState<{ name?: string; priority?: string }>({})
  const save = useMutation({
    mutationFn: () =>
      patch(`/flows/${flow.id}`, {
        name: name.trim(),
        priority: Number(priority),
        reentryPolicy: reentry,
      }),
    onSuccess: () => {
      toast.success('Settings saved.')
      onSaved()
      onOpenChange(false)
    },
    onError: (e) => {
      if (e instanceof ApiError && (e.field('name') || e.field('priority')))
        setErrors({ name: e.field('name'), priority: e.field('priority') })
      else toast.error(e instanceof ApiError ? e.message : 'Could not save the settings.')
    },
  })
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent
        title="Automation settings"
        description="These apply to every version of this automation."
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
          <Field label="Priority" hint={PRIORITY_HINT} error={errors.priority}>
            <Input
              type="number"
              min={0}
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="w-32"
            />
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-slate">
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
                    <span id={`${ids}-${o.value}-hint`} className="text-sm text-secondary">
                      {o.hint}
                    </span>
                  </span>
                </div>
              ))}
            </RadioGroup>
          </fieldset>
        </form>
      </ModalContent>
    </Modal>
  )
}

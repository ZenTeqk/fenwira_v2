'use client'

import { type Contact, type PropertyDefinition, type PropertyValue } from '@fenwira/contracts'
import {
  Button,
  Checkbox,
  Field,
  Input,
  Label,
  Modal,
  ModalClose,
  ModalContent,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@fenwira/ui'
import { useMutation } from '@tanstack/react-query'
import { type FormEvent, useEffect, useState } from 'react'
import { fieldError, FormError } from '@/components/auth/form-error'
import { patch, post } from '@/lib/api/client'
import { useProperties, useTags } from '@/lib/contacts'

type Values = Record<string, string>

function PropertyInput({
  def,
  value,
  onChange,
  error,
}: {
  def: PropertyDefinition
  value: string
  onChange: (v: string) => void
  error?: string
}) {
  if (def.type === 'SELECT' || def.type === 'BOOLEAN') {
    const options = def.type === 'BOOLEAN' ? ['yes', 'no'] : (def.options ?? [])
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`prop-${def.key}`}>{def.label}</Label>
        <Select value={value || '__none'} onValueChange={(v) => onChange(v === '__none' ? '' : v)}>
          <SelectTrigger id={`prop-${def.key}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">Not set</SelectItem>
            {options.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {error ? <p className="text-sm text-status-error-fg">{error}</p> : null}
      </div>
    )
  }
  return (
    <Field label={def.label} error={error}>
      <Input
        type={def.type === 'NUMBER' ? 'number' : def.type === 'DATE' ? 'date' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={def.required}
      />
    </Field>
  )
}

const toText = (v: PropertyValue | undefined) =>
  v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v)

/** Create (contact = null) or edit a contact, including custom fields. */
export function ContactFormModal({
  open,
  onOpenChange,
  contact,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  contact?: Contact | null
  onSaved: (c: Contact) => void
}) {
  const defs = (useProperties().data ?? []).filter((d) => !d.archived)
  const tags = useTags().data ?? []
  const [form, setForm] = useState<Values>({})
  const [props, setProps] = useState<Values>({})
  const [tagIds, setTagIds] = useState<string[]>([])
  const [optedIn, setOptedIn] = useState(false)
  const [consentNote, setConsentNote] = useState('')

  useEffect(() => {
    if (!open) return
    setForm({
      phone: contact?.phoneE164 ?? '',
      name: contact?.name ?? '',
      email: contact?.email ?? '',
      language: contact?.language ?? '',
      country: contact?.country ?? '',
    })
    setProps(Object.fromEntries(defs.map((d) => [d.key, toText(contact?.properties[d.key])])))
    setTagIds([])
    setOptedIn(false)
    setConsentNote('')
    // Reset only when the dialog opens (or for another contact), not on every defs refetch.
  }, [open, contact?.id])

  const save = useMutation({
    mutationFn: async () => {
      const properties = Object.fromEntries(
        defs.map((d) => {
          const v = props[d.key] ?? ''
          if (v === '') return [d.key, null]
          if (d.type === 'NUMBER') return [d.key, Number(v)]
          return [d.key, v]
        }),
      )
      const core = {
        name: form.name || null,
        email: form.email || null,
        language: form.language || null,
        country: form.country || null,
        properties,
      }
      if (contact)
        return patch<{ data: Contact }>(`/contacts/${contact.id}`, { ...core, phone: form.phone })
      return post<{ data: Contact }>('/contacts', {
        phone: form.phone,
        ...core,
        tagIds,
        consents: optedIn
          ? [
              {
                purpose: 'MARKETING',
                status: 'GRANTED',
                source: 'MANUAL',
                note: consentNote || undefined,
              },
            ]
          : [],
      })
    },
    onSuccess: (res) => {
      onSaved(res.data)
      onOpenChange(false)
    },
  })
  const set = (k: string) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent
        title={contact ? 'Edit contact' : 'New contact'}
        description={
          contact ? undefined : 'Numbers without a country code use the workspace country.'
        }
        footer={
          <>
            <ModalClose asChild>
              <Button variant="secondary">Cancel</Button>
            </ModalClose>
            <Button type="submit" form="contact-form" loading={save.isPending}>
              {contact ? 'Save changes' : 'Create contact'}
            </Button>
          </>
        }
      >
        <form
          id="contact-form"
          className="flex flex-col gap-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <FormError error={save.error} />
          <Field label="Phone" error={fieldError(save.error, 'phone')}>
            <Input type="tel" value={form.phone ?? ''} onChange={set('phone')} required autoFocus />
          </Field>
          <Field label="Name" error={fieldError(save.error, 'name')}>
            <Input value={form.name ?? ''} onChange={set('name')} maxLength={120} />
          </Field>
          <Field label="Email" error={fieldError(save.error, 'email')}>
            <Input type="email" value={form.email ?? ''} onChange={set('email')} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Language"
              hint="For example en or hi"
              error={fieldError(save.error, 'language')}
            >
              <Input value={form.language ?? ''} onChange={set('language')} />
            </Field>
            <Field
              label="Country"
              hint="Two letters, for example IN"
              error={fieldError(save.error, 'country')}
            >
              <Input value={form.country ?? ''} onChange={set('country')} maxLength={2} />
            </Field>
          </div>
          {defs.map((d) => (
            <PropertyInput
              key={d.key}
              def={d}
              value={props[d.key] ?? ''}
              onChange={(v) => setProps((p) => ({ ...p, [d.key]: v }))}
              error={fieldError(save.error, `properties.${d.key}`)}
            />
          ))}
          {!contact && tags.length ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium text-fg">Tags</legend>
              <div className="flex flex-wrap gap-3">
                {tags.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 text-sm text-fg">
                    <Checkbox
                      checked={tagIds.includes(t.id)}
                      onCheckedChange={(on) =>
                        setTagIds((ids) => (on ? [...ids, t.id] : ids.filter((x) => x !== t.id)))
                      }
                    />
                    {t.name}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          {!contact ? (
            <div className="flex flex-col gap-2 rounded-md border border-border-subtle p-3">
              <label className="flex items-center gap-2 text-sm text-fg">
                <Checkbox checked={optedIn} onCheckedChange={(on) => setOptedIn(on === true)} />
                This contact agreed to receive marketing messages
              </label>
              {optedIn ? (
                <Field label="How did they agree?" hint="Kept as consent evidence.">
                  <Input
                    value={consentNote}
                    onChange={(e) => setConsentNote(e.target.value)}
                    maxLength={500}
                  />
                </Field>
              ) : null}
            </div>
          ) : null}
        </form>
      </ModalContent>
    </Modal>
  )
}

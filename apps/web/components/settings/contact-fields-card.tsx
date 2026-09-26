'use client'

import { PROPERTY_TYPES, type PropertyDefinition, type PropertyType } from '@fenwira/contracts'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { fieldError, FormError } from '@/components/auth/form-error'
import { useSession } from '@/components/session/session-provider'
import { patch, post } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { useProperties } from '@/lib/contacts'

const TYPE_LABEL: Record<PropertyType, string> = {
  TEXT: 'Text',
  NUMBER: 'Number',
  DATE: 'Date',
  BOOLEAN: 'Yes / no',
  SELECT: 'Choice list',
}
const toKey = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 'f_$1')
    .slice(0, 63)

function NewFieldModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const { tenantId } = useSession()
  const queryClient = useQueryClient()
  const [label, setLabel] = useState('')
  const [type, setType] = useState<PropertyType>('TEXT')
  const [options, setOptions] = useState('')
  const create = useMutation({
    mutationFn: () =>
      post('/contact-properties', {
        key: toKey(label),
        label,
        type,
        ...(type === 'SELECT'
          ? {
              options: options
                .split(',')
                .map((o) => o.trim())
                .filter(Boolean),
            }
          : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.tenant(tenantId, 'contact-properties') })
      setLabel('')
      setOptions('')
      onOpenChange(false)
    },
  })
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent
        title="New contact field"
        footer={
          <>
            <ModalClose asChild>
              <Button variant="secondary">Cancel</Button>
            </ModalClose>
            <Button type="submit" form="field-form" loading={create.isPending}>
              Add field
            </Button>
          </>
        }
      >
        <form
          id="field-form"
          className="flex flex-col gap-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            create.mutate()
          }}
        >
          <FormError error={create.error} />
          <Field
            label="Label"
            hint={
              label
                ? `Key: ${toKey(label)} (used in filters and templates; can't change later)`
                : undefined
            }
            error={fieldError(create.error, 'key') ?? fieldError(create.error, 'label')}
          >
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              required
              maxLength={60}
              autoFocus
            />
          </Field>
          <div className="flex flex-col gap-1.5">
            <span id="field-type" className="text-sm font-medium text-slate">
              Type
            </span>
            <Select value={type} onValueChange={(v) => setType(v as PropertyType)}>
              <SelectTrigger aria-labelledby="field-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROPERTY_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {type === 'SELECT' ? (
            <Field
              label="Choices"
              hint="Separate with commas"
              error={fieldError(create.error, 'options')}
            >
              <Input value={options} onChange={(e) => setOptions(e.target.value)} required />
            </Field>
          ) : null}
        </form>
      </ModalContent>
    </Modal>
  )
}

/** Settings → Workspace: custom contact fields (docs/CONTACTS_AND_CONSENT.md → Custom properties). */
export function ContactFieldsCard({ canManage }: { canManage: boolean }) {
  const { tenantId } = useSession()
  const queryClient = useQueryClient()
  const fields = useProperties().data ?? []
  const [open, setOpen] = useState(false)
  const archive = useMutation({
    mutationFn: (f: PropertyDefinition) =>
      patch(`/contact-properties/${f.id}`, { archived: !f.archived }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: keys.tenant(tenantId, 'contact-properties') }),
  })
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <CardTitle as="h2">Contact fields</CardTitle>
          <CardDescription>
            Extra details you keep for each contact, such as city or plan.
          </CardDescription>
        </div>
        {canManage ? (
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Add field
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {fields.length ? (
          <ul className="flex flex-col divide-y divide-border" aria-label="Contact fields">
            {fields.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="flex items-center gap-2">
                  <span className="text-slate">{f.label}</span>
                  <span className="font-mono text-sm text-muted">{f.key}</span>
                  <Badge tone="neutral">{TYPE_LABEL[f.type]}</Badge>
                  {f.archived ? <Badge tone="warning">Archived</Badge> : null}
                </span>
                {canManage ? (
                  <Button size="sm" variant="ghost" onClick={() => archive.mutate(f)}>
                    {f.archived ? 'Restore' : 'Archive'}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-base text-muted">No custom fields yet.</p>
        )}
      </CardContent>
      <NewFieldModal open={open} onOpenChange={setOpen} />
    </Card>
  )
}

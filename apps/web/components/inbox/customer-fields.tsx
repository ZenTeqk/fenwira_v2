'use client'

import { type Contact, type PropertyDefinition } from '@fenwira/contracts'
import { Button } from '@fenwira/ui'
import { Globe, Languages, Mail } from 'lucide-react'
import { type ReactNode } from 'react'
import { countryLabel } from '@/lib/customer-panel'

export function CustomerFields({
  contact,
  definitions,
  editable,
  onEdit,
}: {
  contact: Contact
  definitions: PropertyDefinition[]
  editable: boolean
  onEdit: () => void
}) {
  const value = (text: string | null, add: string) =>
    text?.trim() ? (
      <span className="break-words">{text}</span>
    ) : editable ? (
      <Button
        variant="link"
        size="sm"
        className="h-7 justify-start px-0 text-base"
        onClick={onEdit}
      >
        {add}
      </Button>
    ) : (
      <span className="text-fg-secondary" aria-label="Not provided">
        —
      </span>
    )
  const rows: Array<{ id: string; label: string; icon?: ReactNode; value: ReactNode }> = [
    {
      id: 'email',
      label: 'Email',
      icon: <Mail aria-hidden="true" className="size-4 shrink-0" />,
      value: value(contact.email, 'Add email'),
    },
    {
      id: 'language',
      label: 'Language',
      icon: <Languages aria-hidden="true" className="size-4 shrink-0" />,
      value: value(contact.language, 'Set language'),
    },
    {
      id: 'country',
      label: 'Country',
      icon: <Globe aria-hidden="true" className="size-4 shrink-0" />,
      value: value(contact.country ? countryLabel(contact.country) : null, 'Set country'),
    },
    ...Object.entries(contact.properties).map(([key, stored]) => ({
      id: `property-${key}`,
      label: definitions.find((definition) => definition.key === key)?.label ?? key,
      value:
        stored == null || stored === '' ? (
          <span className="text-fg-secondary">—</span>
        ) : (
          <span className="break-words">
            {typeof stored === 'boolean' ? (stored ? 'Yes' : 'No') : String(stored)}
          </span>
        ),
    })),
  ]
  return (
    <section
      aria-label="Contact fields"
      className="flex min-w-0 flex-col gap-2 border-t border-border-subtle pt-2"
    >
      <h3 className="text-base font-semibold text-fg">Contact information</h3>
      <dl className="grid min-w-0 grid-cols-3 items-start gap-x-2 gap-y-2">
        {rows.map((row) => (
          <div key={row.id} className="contents">
            <dt className="flex min-w-0 items-start gap-1 text-xs text-fg-secondary">
              {row.icon}
              <span className="min-w-0 break-words">{row.label}</span>
            </dt>
            <dd className="col-span-2 min-w-0 text-base text-fg">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

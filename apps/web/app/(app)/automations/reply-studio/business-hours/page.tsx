'use client'
import { businessHoursSchema, type BusinessHours } from '@fenwira/contracts'
import {
  Alert,
  Button,
  Checkbox,
  Field,
  Input,
  PermissionState,
  SettingsPage,
  Textarea,
  toast,
} from '@fenwira/ui'
import { useMutation, useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useState } from 'react'
import { useSession } from '@/components/session/session-provider'
import { automationKey } from '@/lib/automation'
import { errorText, get, put } from '@/lib/api/client'
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
function HoursForm({ initial, writable }: { initial: BusinessHours; writable: boolean }) {
  const [value, setValue] = useState(initial),
    [error, setError] = useState(''),
    [holidayText, setHolidayText] = useState(initial.holidays.join('\n'))
  const save = useMutation({
    mutationFn: () => put('/reply-studio/business-hours', value),
    onSuccess: () => toast.success('Business hours saved.'),
    onError: (e) => setError(errorText(e)),
  })
  return (
    <form
      className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault()
        const parsed = businessHoursSchema.safeParse(value)
        if (!parsed.success) {
          setError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' '))
          return
        }
        setError('')
        save.mutate()
      }}
    >
      {error ? (
        <Alert tone="danger" title="Business hours could not be saved">
          {error}
        </Alert>
      ) : null}
      <Field
        label="Timezone"
        hint="Use a timezone such as Asia/Kolkata. Hours and holidays follow this timezone."
      >
        <Input
          value={value.timezone}
          readOnly={!writable}
          onChange={(e) => setValue({ ...value, timezone: e.target.value })}
        />
      </Field>
      <p className="text-sm text-secondary">
        Opening time is included; closing time is excluded. Closed days and holidays always take the
        No path.
      </p>
      {value.week.map((day, i) => (
        <fieldset key={i} className="flex flex-wrap items-center gap-3 border-b border-border pb-4">
          <legend className="mb-2 text-sm font-semibold text-slate">{DAYS[i]}</legend>
          <label className="flex min-h-11 items-center gap-2 text-sm text-slate">
            <Checkbox
              checked={day.closed}
              disabled={!writable}
              onCheckedChange={(checked) =>
                setValue({
                  ...value,
                  week: value.week.map((d, j) =>
                    j === i ? { ...d, closed: checked === true } : d,
                  ),
                })
              }
            />
            Closed
          </label>
          {(['open', 'close'] as const).map((k) => (
            <Field key={k} label={k === 'open' ? 'Opens' : 'Closes'}>
              <Input
                aria-label={`${DAYS[i]} ${k}`}
                type="time"
                disabled={day.closed || !writable}
                value={day[k]}
                onChange={(e) =>
                  setValue({
                    ...value,
                    week: value.week.map((d, j) => (j === i ? { ...d, [k]: e.target.value } : d)),
                  })
                }
              />
            </Field>
          ))}
        </fieldset>
      ))}
      <Field
        label="Holiday dates"
        hint="One date per line, YYYY-MM-DD. Your business is closed all day."
      >
        <Textarea
          value={holidayText}
          readOnly={!writable}
          onChange={(e) => {
            setHolidayText(e.target.value)
            setValue({
              ...value,
              holidays: e.target.value
                .split('\n')
                .map((v) => v.trim())
                .filter(Boolean),
            })
          }}
        />
      </Field>
      {writable ? (
        <Button type="submit" loading={save.isPending}>
          Save business hours
        </Button>
      ) : null}
    </form>
  )
}
export default function BusinessHoursPage() {
  const { tenantId, can } = useSession()
  const hours = useQuery({
    queryKey: automationKey(tenantId, 'business-hours'),
    queryFn: () => get<{ data: BusinessHours }>('/reply-studio/business-hours').then((r) => r.data),
    enabled: can('automations.read'),
  })
  if (!can('automations.read')) return <PermissionState what="business hours" />
  return (
    <SettingsPage
      header={{
        title: 'Business hours',
        description:
          'Set the weekly schedule and holiday closures used by all your replies and flows.',
        breadcrumbs: [
          { label: 'Automations', href: '/automations' },
          { label: 'Reply Studio', href: '/automations/reply-studio' },
          { label: 'Business hours' },
        ],
        linkAs: Link,
      }}
    >
      {hours.isPending ? (
        <p role="status">Loading business hours…</p>
      ) : hours.isError ? (
        <Alert
          tone="danger"
          title="Could not load business hours"
          action={
            <Button variant="secondary" onClick={() => void hours.refetch()}>
              Retry
            </Button>
          }
        >
          {errorText(hours.error)}
        </Alert>
      ) : (
        <HoursForm initial={hours.data} writable={can('automations.write')} />
      )}
    </SettingsPage>
  )
}

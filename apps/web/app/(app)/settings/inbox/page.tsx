'use client'

import {
  type BusinessHours,
  RESPONSE_ALERT_DEFAULTS,
  type ResponseAlertSettings,
} from '@fenwira/contracts'
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Label,
  PermissionState,
  SettingsPage,
  Skeleton,
  Switch,
  textLink,
  toast,
} from '@fenwira/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { type FormEvent, useEffect, useState } from 'react'
import { fieldError, FormError } from '@/components/auth/form-error'
import { useSession } from '@/components/session/session-provider'
import { get, patch } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { useMembers, useSalesOn } from '@/lib/follow-ups'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** "Mon–Fri 09:00–18:00 · Sat, Sun closed" from the shared schedule. */
function describeHours(h: BusinessHours): string[] {
  const groups: Array<{ days: string[]; label: string }> = []
  h.week.forEach((d, i) => {
    const label = d.closed ? 'closed' : `${d.open}–${d.close}`
    const last = groups.at(-1)
    if (last && last.label === label) last.days.push(DAYS[i]!)
    else groups.push({ days: [DAYS[i]!], label })
  })
  return groups.map((g) => {
    const days = g.days.length > 2 ? `${g.days[0]}–${g.days.at(-1)}` : g.days.join(', ')
    return `${days} ${g.label}`
  })
}

type Form = {
  enabled: boolean
  unassignedMinutes: string
  responseMinutes: string
  escalationMinutes: string
  escalationUserIds: string[]
}

/**
 * Settings → Inbox → Response alerts (docs/RESPONSE_ALERTS.md → Configuration). Off until a
 * manager turns it on. Business hours and the timezone are the workspace's existing settings,
 * linked rather than duplicated.
 */
export default function InboxSettingsPage() {
  const { tenantId, can } = useSession()
  const on = useSalesOn()
  const client = useQueryClient()
  const managers = useMembers('inbox.reassign')
  const allowed = can('inbox.alerts.manage')
  const settings = useQuery({
    queryKey: keys.tenant(tenantId, 'inbox', 'response-alerts'),
    queryFn: () =>
      get<{ data: ResponseAlertSettings }>('/inbox/response-alerts').then((r) => r.data),
    enabled: on && allowed,
  })
  const [form, setForm] = useState<Form>({
    enabled: false,
    unassignedMinutes: String(RESPONSE_ALERT_DEFAULTS.unassignedMinutes),
    responseMinutes: String(RESPONSE_ALERT_DEFAULTS.responseMinutes),
    escalationMinutes: String(RESPONSE_ALERT_DEFAULTS.escalationMinutes),
    escalationUserIds: [],
  })
  useEffect(() => {
    const s = settings.data
    if (s)
      setForm({
        enabled: s.enabled,
        unassignedMinutes: String(s.unassignedMinutes),
        responseMinutes: String(s.responseMinutes),
        escalationMinutes: String(s.escalationMinutes),
        escalationUserIds: s.escalationUserIds,
      })
  }, [settings.data])
  const save = useMutation({
    mutationFn: () =>
      patch<{ data: ResponseAlertSettings }>('/inbox/response-alerts', {
        enabled: form.enabled,
        unassignedMinutes: Number(form.unassignedMinutes),
        responseMinutes: Number(form.responseMinutes),
        escalationMinutes: Number(form.escalationMinutes),
        escalationUserIds: form.escalationUserIds,
      }),
    onSuccess: (r) => {
      client.setQueryData(keys.tenant(tenantId, 'inbox', 'response-alerts'), r.data)
      toast.success('Response alerts saved')
    },
  })

  if (!allowed) return <PermissionState what="response alert settings" />
  const header = {
    title: 'Inbox',
    description: 'Response alerts for customers waiting on your team.',
  }
  if (!on)
    return (
      <SettingsPage header={header}>
        <EmptyState
          title="Follow-ups and sales are off"
          description="Response alerts come with Follow-ups and sales. An admin can turn them on in Settings → Workspace."
        />
      </SettingsPage>
    )
  if (settings.isError) return <ErrorState onRetry={() => void settings.refetch()} />
  const s = settings.data
  const minutes = (key: 'unassignedMinutes' | 'responseMinutes' | 'escalationMinutes') => ({
    value: form[key],
    onChange: (e: { target: { value: string } }) =>
      setForm((f) => ({ ...f, [key]: e.target.value.replace(/\D/g, '').slice(0, 4) })),
  })
  return (
    <SettingsPage header={header}>
      <Card>
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <CardHeader>
            <CardTitle as="h2">Response alerts</CardTitle>
            <CardDescription>
              Alert the team when a customer waits too long for a staff reply. Only business minutes
              count, and each alert is sent once per wait.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {!s ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <>
                {s.issue ? (
                  <Alert tone="warning" title="Needs attention">
                    {s.issue.message}
                  </Alert>
                ) : null}
                <FormError
                  error={
                    fieldError(save.error, 'escalationMinutes') ||
                    fieldError(save.error, 'escalationUserIds')
                      ? null
                      : save.error
                  }
                />
                <div className="flex items-start justify-between gap-4 rounded-md border border-border-subtle p-4">
                  <div className="flex flex-col gap-0.5">
                    <Label htmlFor="ra-enabled">Send response alerts</Label>
                    <p className="text-sm text-fg-muted">
                      Off by default. Turning it on never alerts about waits that started earlier.
                    </p>
                  </div>
                  <Switch
                    id="ra-enabled"
                    checked={form.enabled}
                    onCheckedChange={(enabled) => setForm((f) => ({ ...f, enabled }))}
                  />
                </div>
                <fieldset className="grid gap-4 sm:grid-cols-3">
                  <legend className="mb-2 text-sm font-medium text-fg">
                    Alert after (business minutes)
                  </legend>
                  <Field
                    label="Still unassigned"
                    hint="Tells everyone who can assign conversations."
                  >
                    <Input inputMode="numeric" {...minutes('unassignedMinutes')} />
                  </Field>
                  <Field label="No staff reply" hint="Tells the assignee (or the assigners).">
                    <Input inputMode="numeric" {...minutes('responseMinutes')} />
                  </Field>
                  <Field
                    label="Escalate"
                    hint="Tells the escalation recipients below."
                    error={fieldError(save.error, 'escalationMinutes')}
                  >
                    <Input inputMode="numeric" {...minutes('escalationMinutes')} />
                  </Field>
                </fieldset>
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 text-sm font-medium text-fg">
                    Escalation recipients
                  </legend>
                  <p className="text-sm text-fg-muted">
                    Managers and admins who can assign conversations.
                  </p>
                  {managers.isPending ? (
                    <Skeleton className="h-16" />
                  ) : managers.data.length ? (
                    <ul className="flex flex-col gap-2">
                      {managers.data.map((m) => {
                        const checked = form.escalationUserIds.includes(m.userId)
                        return (
                          <li key={m.userId} className="flex items-center gap-2">
                            <Checkbox
                              id={`ra-${m.userId}`}
                              checked={checked}
                              onCheckedChange={(v) =>
                                setForm((f) => ({
                                  ...f,
                                  escalationUserIds:
                                    v === true
                                      ? [...f.escalationUserIds, m.userId]
                                      : f.escalationUserIds.filter((x) => x !== m.userId),
                                }))
                              }
                            />
                            <Label htmlFor={`ra-${m.userId}`} className="font-normal">
                              {m.name}
                            </Label>
                          </li>
                        )
                      })}
                    </ul>
                  ) : (
                    <p className="text-sm text-fg-secondary">No managers in this workspace yet.</p>
                  )}
                  {fieldError(save.error, 'escalationUserIds') ? (
                    <p className="text-sm text-status-error-fg">
                      {fieldError(save.error, 'escalationUserIds')}
                    </p>
                  ) : null}
                </fieldset>
                <div className="flex flex-col gap-1 rounded-md border border-border-subtle p-4">
                  <p className="text-sm font-medium text-fg">Business hours</p>
                  <ul className="text-sm text-fg-secondary">
                    {describeHours(s.businessHours).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                    {s.businessHours.holidays.length ? (
                      <li>
                        {s.businessHours.holidays.length} holiday
                        {s.businessHours.holidays.length === 1 ? '' : 's'}
                      </li>
                    ) : null}
                  </ul>
                  <p className="text-sm text-fg-secondary">
                    Hours run in {s.businessHours.timezone}
                    {s.businessHoursConfigured ? '' : ' (default hours, not yet customised)'}.
                    Workspace timezone: {s.workspaceTimezone}.
                  </p>
                  <p className="text-sm text-fg-secondary">
                    The same hours as Reply Studio.{' '}
                    {can('automations.write') ? (
                      <Link href="/automations/reply-studio/business-hours" className={textLink}>
                        Edit business hours
                      </Link>
                    ) : (
                      'Ask a manager to change them.'
                    )}
                  </p>
                </div>
                <p className="text-sm text-fg-secondary">
                  Alerts arrive as in-app notifications (the bell) and open the conversation.
                  Fenwira has no per-person notification preferences yet.
                </p>
              </>
            )}
          </CardContent>
          {s ? (
            <CardFooter className="justify-end">
              <Button type="submit" loading={save.isPending}>
                Save changes
              </Button>
            </CardFooter>
          ) : null}
        </form>
      </Card>
    </SettingsPage>
  )
}

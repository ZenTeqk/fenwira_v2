'use client'

import { type SecurityEvent, type Session } from '@fenwira/contracts'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
  toast,
  useConfirm,
} from '@fenwira/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { del, get, post } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** Short, human label for a browser user-agent string. */
export function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device'
  const browsers: Array<[RegExp, string]> = [
    [/Edg\//, 'Edge'],
    [/Chrome\//, 'Chrome'],
    [/Firefox\//, 'Firefox'],
    [/Safari\//, 'Safari'],
  ]
  const systems: Array<[RegExp, string]> = [
    [/iPhone|iPad/, 'iOS'],
    [/Android/, 'Android'],
    [/Mac OS X/, 'macOS'],
    [/Windows/, 'Windows'],
    [/Linux/, 'Linux'],
  ]
  const browser = browsers.find(([re]) => re.test(userAgent))?.[1] ?? 'Browser'
  const system = systems.find(([re]) => re.test(userAgent))?.[1]
  return system ? `${browser} on ${system}` : browser
}

export function SessionsCard() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const sessions = useQuery({
    queryKey: keys.sessions,
    queryFn: () => get<{ data: Session[] }>('/me/sessions', { tenant: false }).then((r) => r.data),
  })
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: keys.sessions })
    void queryClient.invalidateQueries({ queryKey: keys.securityEvents })
  }
  const revoke = useMutation({
    mutationFn: (id: string) => del(`/me/sessions/${id}`),
    onSuccess: refresh,
  })
  const revokeOthers = useMutation({
    mutationFn: () => post<{ data: { revoked: number } }>('/me/sessions/revoke-others'),
    onSuccess: ({ data }) => {
      toast.success(`Signed out ${data.revoked} other session${data.revoked === 1 ? '' : 's'}`)
      refresh()
    },
  })
  const others = (sessions.data ?? []).filter((s) => !s.current)

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Where you're signed in</CardTitle>
          <Button
            variant="secondary"
            size="sm"
            disabled={others.length === 0}
            loading={revokeOthers.isPending}
            onClick={async () => {
              if (
                await confirm({
                  title: 'Sign out of all other sessions?',
                  confirmLabel: 'Sign out others',
                  destructive: true,
                })
              )
                revokeOthers.mutate()
            }}
          >
            Sign out other sessions
          </Button>
        </div>
        <CardDescription>Sign out any session you don't recognize.</CardDescription>
      </CardHeader>
      <CardContent>
        {sessions.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <ul className="flex flex-col divide-y divide-border" aria-label="Active sessions">
            {(sessions.data ?? []).map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 flex-col">
                  <span className="flex items-center gap-2 font-medium text-slate">
                    {deviceLabel(s.userAgent)}
                    {s.current ? <Badge tone="primary">This device</Badge> : null}
                  </span>
                  <span className="text-sm text-muted">
                    {s.ip ?? 'Unknown IP'} · last active {dateFormat.format(new Date(s.lastUsedAt))}
                  </span>
                </div>
                {s.current ? null : (
                  <Button variant="ghost" size="sm" onClick={() => revoke.mutate(s.id)}>
                    Sign out
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

const EVENT_LABELS: Record<SecurityEvent['type'], string> = {
  LOGIN_SUCCEEDED: 'Signed in',
  LOGIN_FAILED: 'Failed sign-in attempt',
  LOGOUT: 'Signed out',
  PASSWORD_CHANGED: 'Password changed',
  PASSWORD_RESET: 'Password reset by email',
  EMAIL_VERIFIED: 'Email verified',
  TWO_FACTOR_ENABLED: 'Two-factor turned on',
  TWO_FACTOR_DISABLED: 'Two-factor turned off',
  BACKUP_CODE_USED: 'Backup code used',
  SESSION_REVOKED: 'A session was signed out',
  ALL_SESSIONS_REVOKED: 'Other sessions signed out',
  REFRESH_TOKEN_REUSE: 'Reused session blocked',
}

export function ActivityCard() {
  const events = useQuery({
    queryKey: keys.securityEvents,
    queryFn: () =>
      get<{ data: SecurityEvent[] }>('/me/security-events', { tenant: false }).then((r) => r.data),
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent security activity</CardTitle>
        <CardDescription>Sign-ins and changes to your account.</CardDescription>
      </CardHeader>
      <CardContent>
        {events.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : events.data?.length ? (
          <ul className="flex flex-col divide-y divide-border" aria-label="Security activity">
            {events.data.slice(0, 20).map((e) => (
              <li key={e.id} className="flex flex-wrap justify-between gap-2 py-2.5">
                <span className="text-slate">{EVENT_LABELS[e.type]}</span>
                <span className="text-sm text-muted">
                  {dateFormat.format(new Date(e.createdAt))}
                  {e.ip ? ` · ${e.ip}` : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No activity yet" />
        )}
      </CardContent>
    </Card>
  )
}

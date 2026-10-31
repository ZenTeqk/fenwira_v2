'use client'

import { CannedRepliesCard } from '@/components/settings/canned-replies-card'
import { ConsentKeywordsCard } from '@/components/settings/consent-keywords-card'
import { ContactFieldsCard } from '@/components/settings/contact-fields-card'

import { type Member, type Workspace } from '@fenwira/contracts'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  ErrorState,
  Field,
  Input,
  Label,
  PermissionState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsPage,
  Skeleton,
  Switch,
  toast,
  useConfirm,
} from '@fenwira/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { TriangleAlert } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type FormEvent, useEffect, useState } from 'react'
import { fieldError, FormError } from '@/components/auth/form-error'
import { useSession } from '@/components/session/session-provider'
import { del, get, patch, post } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { COUNTRIES, INDIA_TIMEZONE, INDIA_TIMEZONE_LABEL } from '@/lib/locale'

export default function WorkspaceSettingsPage() {
  const { tenantId, can, membership } = useSession()
  const queryClient = useQueryClient()
  const router = useRouter()
  const confirm = useConfirm()
  const canManage = can('workspace.manage')
  const isOwner = membership.role === 'OWNER'

  const workspace = useQuery({
    queryKey: keys.tenant(tenantId, 'workspace'),
    queryFn: () => get<{ data: Workspace }>('/workspace').then((r) => r.data),
    enabled: can('workspace.read'),
  })
  const members = useQuery({
    queryKey: keys.tenant(tenantId, 'members'),
    queryFn: () => get<{ data: Member[] }>('/team/members').then((r) => r.data),
    enabled: isOwner,
  })

  const [form, setForm] = useState({
    name: '',
    country: 'IN',
    timezone: INDIA_TIMEZONE,
    require2fa: false,
  })
  const [transferTo, setTransferTo] = useState('')
  useEffect(() => {
    if (workspace.data) {
      const w = workspace.data
      // Every workspace runs on India time; saving also moves an older workspace to IST.
      setForm({
        name: w.name,
        country: w.country,
        timezone: INDIA_TIMEZONE,
        require2fa: w.require2fa,
      })
    }
  }, [workspace.data])

  const save = useMutation({
    mutationFn: () => patch<{ data: Workspace }>('/workspace', form),
    onSuccess: () => {
      toast.success('Workspace settings saved')
      void queryClient.invalidateQueries({ queryKey: keys.tenant(tenantId, 'workspace') })
      void queryClient.invalidateQueries({ queryKey: keys.me })
    },
  })
  const transfer = useMutation({
    mutationFn: () => post('/workspace/transfer-ownership', { membershipId: transferTo }),
    onSuccess: async () => {
      toast.success('Ownership transferred. You are now an admin.')
      await queryClient.invalidateQueries({ queryKey: keys.me })
    },
  })
  const remove = useMutation({
    mutationFn: () => del('/workspace'),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.me })
      router.replace('/dashboard')
    },
  })

  if (!can('workspace.read')) return <PermissionState what="workspace settings" />
  if (workspace.isError) return <ErrorState onRetry={() => void workspace.refetch()} />

  const candidates = (members.data ?? []).filter((m) => m.status === 'ACTIVE' && m.role !== 'OWNER')

  return (
    <SettingsPage
      header={{
        title: 'Workspace',
        description: 'Name, region and security settings for this workspace.',
      }}
    >
      <Card>
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <CardHeader>
            <CardTitle as="h2">General</CardTitle>
            <CardDescription>
              {canManage
                ? 'Visible to everyone in the workspace.'
                : 'Only admins can change these settings.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {workspace.isPending ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <>
                {fieldError(save.error, 'name') ? null : <FormError error={save.error} />}
                <Field label="Workspace name" error={fieldError(save.error, 'name')}>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    disabled={!canManage}
                  />
                </Field>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="ws-country">Country</Label>
                    <Select
                      value={form.country}
                      onValueChange={(country) => setForm((f) => ({ ...f, country }))}
                      disabled={!canManage}
                    >
                      <SelectTrigger id="ws-country">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {COUNTRIES.map((c) => (
                          <SelectItem key={c.code} value={c.code}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="ws-timezone">Timezone</Label>
                    <Input id="ws-timezone" readOnly value={INDIA_TIMEZONE_LABEL} />
                  </div>
                </div>
                <div className="flex items-start justify-between gap-4 rounded-md border border-border-subtle p-4">
                  <div className="flex flex-col gap-0.5">
                    <Label htmlFor="ws-2fa">Require two-factor authentication</Label>
                    <p className="text-sm text-fg-muted">
                      Members without 2FA are asked to turn it on before they can use this
                      workspace.
                    </p>
                  </div>
                  <Switch
                    id="ws-2fa"
                    checked={form.require2fa}
                    onCheckedChange={(require2fa) => setForm((f) => ({ ...f, require2fa }))}
                    disabled={!canManage}
                  />
                </div>
              </>
            )}
          </CardContent>
          {canManage ? (
            <CardFooter className="justify-end">
              <Button type="submit" loading={save.isPending}>
                Save changes
              </Button>
            </CardFooter>
          ) : null}
        </form>
      </Card>

      <ContactFieldsCard canManage={can('contacts.properties.manage')} />
      <ConsentKeywordsCard canManage={can('workspace.manage')} />
      {can('inbox.reply') ? (
        <CannedRepliesCard canManage={can('inbox.canned_replies.manage')} />
      ) : null}

      {isOwner ? (
        <Card className="border-status-error-border">
          <CardHeader>
            <CardTitle as="h2" className="flex items-center gap-2">
              <TriangleAlert aria-hidden="true" className="size-4 text-status-error-fg" />
              Danger zone
            </CardTitle>
            <CardDescription>Only the workspace owner can do these.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <FormError error={transfer.error ?? remove.error} />
            <div className="flex flex-col gap-3 md:flex-row md:items-end">
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor="ws-transfer">Transfer ownership</Label>
                <Select value={transferTo} onValueChange={setTransferTo}>
                  <SelectTrigger id="ws-transfer">
                    <SelectValue
                      placeholder={
                        candidates.length ? 'Choose a member' : 'No other active members'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {candidates.map((m) => (
                      <SelectItem key={m.membershipId} value={m.membershipId}>
                        {m.name} · {m.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant="secondary"
                disabled={!transferTo}
                loading={transfer.isPending}
                onClick={async () => {
                  const target = candidates.find((m) => m.membershipId === transferTo)
                  if (
                    await confirm({
                      title: `Make ${target?.name} the owner?`,
                      description: 'You will become an admin. This takes effect immediately.',
                      confirmLabel: 'Transfer ownership',
                      destructive: true,
                    })
                  )
                    transfer.mutate()
                }}
              >
                Transfer
              </Button>
            </div>
            <div className="flex flex-col gap-3 border-t border-border-subtle pt-6 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-base font-medium text-fg">Delete workspace</p>
                <p className="text-sm text-fg-muted">
                  Everyone loses access. Data is kept for 30 days, then deleted.
                </p>
              </div>
              <Button
                variant="danger"
                loading={remove.isPending}
                onClick={async () => {
                  if (
                    await confirm({
                      title: `Delete ${workspace.data?.name}?`,
                      description: 'Every member loses access immediately.',
                      confirmLabel: 'Delete workspace',
                      destructive: true,
                    })
                  )
                    remove.mutate()
                }}
              >
                Delete workspace
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </SettingsPage>
  )
}

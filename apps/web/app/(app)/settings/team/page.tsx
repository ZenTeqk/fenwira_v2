'use client'

import {
  canAssignRole,
  type Invitation,
  type Member,
  type Role,
  ROLE_LABELS,
  ROLES,
} from '@fenwira/contracts'
import {
  Badge,
  Button,
  type ColumnDef,
  DataTable,
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownTrigger,
  Field,
  Input,
  Label,
  Modal,
  ModalClose,
  ModalContent,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusBadge,
  toast,
  useConfirm,
} from '@fenwira/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal, ShieldCheck, UserPlus } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { fieldError, FormError } from '@/components/auth/form-error'
import { useSession } from '@/components/session/session-provider'
import { NoAccess } from '@/components/settings/no-access'
import { ApiError, get, patch, post } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'

const assignable = (actor: Role) => ROLES.filter((r) => canAssignRole(actor, r))

function InviteModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { tenantId, membership } = useSession()
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('AGENT')
  const invite = useMutation({
    mutationFn: () => post('/team/invitations', { email, role }),
    onSuccess: () => {
      toast.success(`Invitation sent to ${email}`)
      setEmail('')
      onOpenChange(false)
      void queryClient.invalidateQueries({ queryKey: keys.tenant(tenantId, 'invitations') })
    },
  })
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent
        title="Invite a teammate"
        description="They'll get an email with a link to join this workspace."
        footer={
          <>
            <ModalClose asChild>
              <Button variant="secondary">Cancel</Button>
            </ModalClose>
            <Button type="submit" form="invite-form" loading={invite.isPending}>
              Send invitation
            </Button>
          </>
        }
      >
        <form
          id="invite-form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            invite.mutate()
          }}
          className="flex flex-col gap-4"
        >
          {fieldError(invite.error, 'email') ? null : <FormError error={invite.error} />}
          <Field label="Email" error={fieldError(invite.error, 'email')}>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </Field>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-role">Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger id="invite-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {assignable(membership.role).map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </form>
      </ModalContent>
    </Modal>
  )
}

export default function TeamSettingsPage() {
  const { tenantId, can, me, membership } = useSession()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [inviteOpen, setInviteOpen] = useState(false)
  const canManage = can('team.manage')

  const members = useQuery({
    queryKey: keys.tenant(tenantId, 'members'),
    queryFn: () => get<{ data: Member[] }>('/team/members').then((r) => r.data),
    enabled: can('team.read'),
  })
  const invitations = useQuery({
    queryKey: keys.tenant(tenantId, 'invitations'),
    queryFn: () => get<{ data: Invitation[] }>('/team/invitations').then((r) => r.data),
    enabled: canManage,
  })
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: keys.tenant(tenantId, 'members') })
    void queryClient.invalidateQueries({ queryKey: keys.tenant(tenantId, 'invitations') })
  }
  const onError = (err: unknown) =>
    toast.error(err instanceof ApiError ? err.message : 'Something went wrong.')
  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) =>
      patch(`/team/members/${id}`, { role }),
    onSuccess: () => {
      toast.success('Role updated')
      refresh()
    },
    onError,
  })
  const setActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      post(`/team/members/${id}/${active ? 'reactivate' : 'deactivate'}`),
    onSuccess: refresh,
    onError,
  })
  const inviteAction = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'resend' | 'revoke' }) =>
      post(`/team/invitations/${id}/${action}`),
    onSuccess: (_d, v) => {
      toast.success(v.action === 'resend' ? 'Invitation resent' : 'Invitation revoked')
      refresh()
    },
    onError,
  })

  if (!can('team.read')) return <NoAccess what="the team" />

  const memberColumns: ColumnDef<Member, unknown>[] = [
    {
      accessorKey: 'name',
      header: 'Member',
      cell: ({ row }) => (
        <div className="flex min-w-0 flex-col">
          <span className="font-medium text-slate">
            {row.original.name}
            {row.original.userId === me.user.id ? (
              <span className="ml-1 text-sm font-normal text-muted">(you)</span>
            ) : null}
          </span>
          <span className="truncate text-sm text-muted">{row.original.email}</span>
        </div>
      ),
    },
    {
      accessorKey: 'role',
      header: 'Role',
      cell: ({ row }) => {
        const m = row.original
        const editable =
          canManage && m.role !== 'OWNER' && m.userId !== me.user.id && m.status === 'ACTIVE'
        if (!editable) return <span className="text-slate">{ROLE_LABELS[m.role]}</span>
        return (
          <Select
            value={m.role}
            onValueChange={(role) => changeRole.mutate({ id: m.membershipId, role: role as Role })}
          >
            <SelectTrigger className="h-8 w-32" aria-label={`Role for ${m.name}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {assignable(membership.role).map((r) => (
                <SelectItem key={r} value={r}>
                  {ROLE_LABELS[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      },
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1.5">
          <StatusBadge status={row.original.status} />
          {row.original.twoFactorEnabled ? (
            <Badge tone="info" icon={<ShieldCheck />}>
              2FA
            </Badge>
          ) : null}
        </div>
      ),
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => {
        const m = row.original
        if (!canManage || m.role === 'OWNER' || m.userId === me.user.id) return null
        return (
          <Dropdown>
            <DropdownTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Actions for ${m.name}`}>
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownTrigger>
            <DropdownContent>
              {m.status === 'ACTIVE' ? (
                <DropdownItem
                  destructive
                  onSelect={async () => {
                    if (
                      await confirm({
                        title: `Deactivate ${m.name}?`,
                        description: 'They lose access to this workspace immediately.',
                        confirmLabel: 'Deactivate',
                        destructive: true,
                      })
                    )
                      setActive.mutate({ id: m.membershipId, active: false })
                  }}
                >
                  Deactivate
                </DropdownItem>
              ) : (
                <DropdownItem
                  onSelect={() => setActive.mutate({ id: m.membershipId, active: true })}
                >
                  Reactivate
                </DropdownItem>
              )}
            </DropdownContent>
          </Dropdown>
        )
      },
    },
  ]

  const invitationColumns: ColumnDef<Invitation, unknown>[] = [
    { accessorKey: 'email', header: 'Email' },
    { accessorKey: 'role', header: 'Role', cell: ({ row }) => ROLE_LABELS[row.original.role] },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    { accessorKey: 'invitedByName', header: 'Invited by' },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) =>
        row.original.status === 'PENDING' ? (
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => inviteAction.mutate({ id: row.original.id, action: 'resend' })}
            >
              Resend
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                if (
                  await confirm({
                    title: `Revoke the invitation for ${row.original.email}?`,
                    confirmLabel: 'Revoke',
                    destructive: true,
                  })
                )
                  inviteAction.mutate({ id: row.original.id, action: 'revoke' })
              }}
            >
              Revoke
            </Button>
          </div>
        ) : null,
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Team"
        description="People with access to this workspace and what they can do."
        actions={
          canManage ? (
            <Button onClick={() => setInviteOpen(true)}>
              <UserPlus aria-hidden="true" />
              Invite teammate
            </Button>
          ) : null
        }
      />
      <DataTable
        label="Team members"
        columns={memberColumns}
        data={members.data ?? []}
        getRowId={(m) => m.membershipId}
        loading={members.isPending}
        error={members.isError ? { onRetry: () => void members.refetch() } : undefined}
        empty={{ title: 'No members yet' }}
      />
      {canManage ? (
        <section aria-labelledby="pending-invitations" className="flex flex-col gap-3">
          <h2 id="pending-invitations" className="text-md font-semibold text-slate">
            Pending invitations
          </h2>
          <DataTable
            label="Pending invitations"
            columns={invitationColumns}
            data={invitations.data ?? []}
            getRowId={(i) => i.id}
            loading={invitations.isPending}
            empty={{
              title: 'No pending invitations',
              description: 'Invite teammates to share the inbox.',
            }}
          />
        </section>
      ) : null}
      <InviteModal open={inviteOpen} onOpenChange={setInviteOpen} />
    </div>
  )
}

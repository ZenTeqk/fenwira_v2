'use client'
import {
  createWorkspaceWithOwnerSchema,
  emailDeliverySchema,
  oneTimeLinkSchema,
  platformMemberSchema,
  provisionedWorkspaceSchema,
  type OneTimeLink,
  type ProvisionedWorkspace,
} from '@fenwira/contracts'
import {
  Alert,
  Button,
  DetailDrawer,
  EmptyState,
  ErrorState,
  Field,
  Input,
  ListPage,
  Skeleton,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@fenwira/ui'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { type FormEvent, useState } from 'react'
import { z } from 'zod'
import { CopyLink } from '@/components/copy-link'
import { ApiError } from '@/lib/api/client'
import { platformRequest } from '@/lib/platform'
import { usePlatform } from './platform-shell'

const failure = (err: unknown) =>
  err instanceof ApiError
    ? err.code === 'TOTP_REQUIRED'
      ? 'Verify your identity again (Commercial operations card in any workspace), then retry.'
      : err.message
    : 'Request failed.'

/** ADR-0027 step 4: create a workspace and its owner in one step; hand the owner a setup link. */
export function ProvisionWorkspace() {
  const me = usePlatform()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ workspaceName: '', ownerName: '', ownerEmail: '' })
  const [result, setResult] = useState<ProvisionedWorkspace | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!me?.permissions.includes('workspaces.manage')) return null
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))
  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    const parsed = createWorkspaceWithOwnerSchema.safeParse(form)
    if (!parsed.success) return setError(parsed.error.issues.map((i) => i.message).join(' · '))
    setBusy(true)
    try {
      setResult(
        provisionedWorkspaceSchema.parse(
          await platformRequest('/workspaces/provision', parsed.data),
        ),
      )
      setForm({ workspaceName: '', ownerName: '', ownerEmail: '' })
    } catch (err) {
      setError(failure(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Button onClick={() => setOpen(true)}>Create workspace</Button>
      <DetailDrawer
        open={open}
        onOpenChange={(v) => {
          if (busy) return
          if (!v) setResult(null)
          setOpen(v)
        }}
        title={result ? 'Workspace created' : 'Create workspace'}
        description={
          result
            ? 'Send the owner this link. They set a password, sign in and invite their team.'
            : 'Creates the workspace and its owner account. No email is needed.'
        }
      >
        {result ? (
          <div className="flex flex-col gap-4">
            {result.setupLink ? (
              <CopyLink
                link={result.setupLink}
                expiresAt={result.setupExpiresAt}
                label="Owner setup link"
              />
            ) : (
              <Alert tone="info" title="The owner already has a Fenwira account">
                They sign in with their existing password and will see the new workspace.
              </Alert>
            )}
            <Button asChild variant="secondary">
              <Link href={`/platform/workspaces/${result.workspaceId}`}>Open workspace</Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field label="Workspace name" required>
              <Input required value={form.workspaceName} onChange={set('workspaceName')} />
            </Field>
            <Field label="Owner name" required>
              <Input required value={form.ownerName} onChange={set('ownerName')} />
            </Field>
            <Field label="Owner email" required>
              <Input required type="email" value={form.ownerEmail} onChange={set('ownerEmail')} />
            </Field>
            {error ? (
              <Alert tone="danger" title="Not created">
                {error}
              </Alert>
            ) : null}
            <Button type="submit" loading={busy}>
              Create workspace and owner
            </Button>
          </form>
        )}
      </DetailDrawer>
    </>
  )
}

/** Members of a workspace, with one-time password-reset links (ML-D4: operators only). */
export function WorkspaceMembers({ workspaceId }: { workspaceId: string }) {
  const me = usePlatform()
  const canManage = me?.permissions.includes('workspaces.manage') ?? false
  const members = useQuery({
    queryKey: ['platform', 'members', workspaceId],
    retry: false,
    queryFn: async () =>
      z
        .array(platformMemberSchema)
        .parse(await platformRequest(`/workspaces/${workspaceId}/members`)),
  })
  const [link, setLink] = useState<(OneTimeLink & { name: string }) | null>(null)
  async function reset(userId: string, name: string) {
    try {
      const issued = oneTimeLinkSchema.parse(
        await platformRequest(`/workspaces/${workspaceId}/members/${userId}/reset-link`, {}),
      )
      setLink({ ...issued, name })
    } catch (err) {
      toast.error(failure(err))
    }
  }
  return (
    <section aria-labelledby="members-heading" className="flex flex-col gap-3">
      <h2 id="members-heading" className="text-lg font-semibold">
        Team
      </h2>
      {members.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : members.isError ? (
        <ErrorState onRetry={() => void members.refetch()} />
      ) : members.data.length === 0 ? (
        <EmptyState title="No members" />
      ) : (
        <Table containerLabel="Workspace members">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.data.map((m) => (
              <TableRow key={m.userId}>
                <TableCell>{m.name}</TableCell>
                <TableCell>{m.email}</TableCell>
                <TableCell>{m.role}</TableCell>
                <TableCell>
                  {m.emailVerified ? (
                    <StatusBadge status="ACTIVE" label="Active" />
                  ) : (
                    <StatusBadge status="PENDING" label="Setup pending" />
                  )}
                </TableCell>
                <TableCell>
                  {canManage && m.status === 'ACTIVE' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void reset(m.userId, m.name)}
                      aria-label={`Password link for ${m.name}`}
                    >
                      Password link
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <DetailDrawer
        open={link !== null}
        onOpenChange={(v) => !v && setLink(null)}
        title={link ? `Password link for ${link.name}` : 'Password link'}
        description="Older links stop working. Emailed too when email is set up."
      >
        {link ? (
          <CopyLink link={link.link} expiresAt={link.expiresAt} label="Password link" />
        ) : null}
      </DetailDrawer>
    </section>
  )
}

/** ADR-0027 step 4: every email the worker attempted, so missing SMTP or failures are visible. */
export function EmailDeliveriesView() {
  const deliveries = useQuery({
    queryKey: ['platform', 'email-deliveries'],
    retry: false,
    queryFn: async () =>
      z.array(emailDeliverySchema).parse(await platformRequest('/email-deliveries')),
  })
  const tone = {
    SENT: 'SUCCEEDED',
    FAILED: 'FAILED',
    SKIPPED_NO_SMTP: 'SKIPPED',
    SUPPRESSED: 'CANCELLED',
  } as const
  return (
    <ListPage
      header={{
        title: 'Email',
        description:
          'The last 100 emails the worker attempted. Skipped means SMTP is not configured: share links from the console instead.',
      }}
    >
      {deliveries.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : deliveries.isError ? (
        <ErrorState onRetry={() => void deliveries.refetch()} />
      ) : deliveries.data.length === 0 ? (
        <EmptyState title="No emails yet" />
      ) : (
        <Table containerLabel="Email deliveries">
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Outcome</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deliveries.data.map((d) => (
              <TableRow key={d.id}>
                <TableCell>{new Date(d.createdAt).toLocaleString()}</TableCell>
                <TableCell>{d.kind.replaceAll('_', ' ')}</TableCell>
                <TableCell>{d.recipientHint}</TableCell>
                <TableCell>
                  <StatusBadge
                    status={tone[d.status]}
                    label={`${d.status.replaceAll('_', ' ').toLowerCase()}${d.errorCode ? ` (${d.errorCode})` : ''}`}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </ListPage>
  )
}

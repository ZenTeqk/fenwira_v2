'use client'
import { platformDeletedWorkspaceSchema, restoreWorkspaceRequestSchema } from '@fenwira/contracts'
import {
  Button,
  DetailDrawer,
  Field,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@fenwira/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { z } from 'zod'
import { fieldError, FormError } from '@/components/auth/form-error'
import { platformRequest } from '@/lib/platform'
import { useIdentityRequest } from './identity'
import { usePlatform } from './platform-shell'

/** Deleted workspaces (soft delete keeps the data): restore one with a reason. */
export function DeletedWorkspaces() {
  const me = usePlatform()
  const request = useIdentityRequest()
  const cache = useQueryClient()
  const canManage = me?.permissions.includes('workspaces.manage') ?? false
  const deleted = useQuery({
    queryKey: ['platform', 'deleted-workspaces'],
    retry: false,
    queryFn: async () =>
      z.array(platformDeletedWorkspaceSchema).parse(await platformRequest('/deleted-workspaces')),
  })
  const [target, setTarget] = useState<{ id: string; name: string } | null>(null),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!target) return
    setBusy(true)
    setError(null)
    try {
      await request(
        `/workspaces/${target.id}/restore`,
        restoreWorkspaceRequestSchema.parse({ reason }),
      )
      toast.success(`${target.name} restored`)
      setTarget(null)
      setReason('')
      await Promise.all(
        [
          ['platform', 'deleted-workspaces'],
          ['platform', 'workspace-list'],
        ].map((queryKey) => cache.invalidateQueries({ queryKey })),
      )
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }
  const rows = deleted.data ?? []
  return (
    <details className="rounded-md border border-border bg-surface p-4">
      <summary className="cursor-pointer font-medium">
        Deleted workspaces ({deleted.isPending ? '…' : rows.length})
      </summary>
      <p className="mt-2 text-sm text-secondary">
        Deleting keeps all data. Restore brings the workspace back for its members exactly as it
        was; reconnect its WhatsApp number afterwards if needed.
      </p>
      {deleted.isError ? (
        <p className="mt-3 text-sm text-danger-strong">Could not load deleted workspaces.</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-secondary">No deleted workspaces.</p>
      ) : (
        <div className="mt-3">
          <Table containerLabel="Deleted workspaces">
            <TableHeader>
              <TableRow>
                <TableHead>Workspace</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Deleted</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((w) => (
                <TableRow key={w.id}>
                  <TableCell>
                    <span className="font-medium">{w.name}</span>
                    <p className="text-xs text-secondary">{w.slug}</p>
                  </TableCell>
                  <TableCell className="break-all">{w.ownerEmail ?? '—'}</TableCell>
                  <TableCell>{new Date(w.deletedAt).toLocaleString()}</TableCell>
                  <TableCell>
                    {canManage ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label={`Restore ${w.name}`}
                        onClick={() => setTarget({ id: w.id, name: w.name })}
                      >
                        Restore
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <DetailDrawer
        open={target !== null}
        onOpenChange={(v) => {
          if (busy || v) return
          setTarget(null)
          setReason('')
          setError(null)
        }}
        title={target ? `Restore ${target.name}?` : 'Restore workspace'}
        description="Its members get access again immediately. This is recorded in the audit log."
      >
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field
            label="Reason"
            required
            hint="At least 5 characters, for example: deleted by mistake."
            error={fieldError(error, 'reason')}
          >
            <Input
              required
              minLength={5}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <FormError error={error} />
          <Button type="submit" loading={busy} disabled={reason.trim().length < 5}>
            Restore workspace
          </Button>
        </form>
      </DetailDrawer>
    </details>
  )
}

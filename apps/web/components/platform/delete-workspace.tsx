'use client'
import { deleteWorkspaceRequestSchema } from '@fenwira/contracts'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailDrawer,
  Field,
  Input,
  toast,
} from '@fenwira/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'
import { fieldError, FormError } from '@/components/auth/form-error'
import { useIdentityRequest } from './identity'
import { usePlatform } from './platform-shell'

/** Removes an unwanted workspace (soft delete; data is kept). Never the internal workspace. */
export function DeleteWorkspace({
  workspace,
}: {
  workspace: { id: string; name: string; isInternal?: boolean }
}) {
  const me = usePlatform()
  const request = useIdentityRequest()
  const router = useRouter()
  const cache = useQueryClient()
  const [open, setOpen] = useState(false),
    [confirmName, setConfirmName] = useState(''),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null)
  if (!me?.permissions.includes('workspaces.manage') || workspace.isInternal) return null
  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await request(
        `/workspaces/${workspace.id}/delete`,
        deleteWorkspaceRequestSchema.parse({ confirmName, reason }),
      )
      toast.success(`${workspace.name} deleted`)
      await cache.invalidateQueries({ queryKey: ['platform', 'workspace-list'] })
      cache.removeQueries({ queryKey: ['platform', 'workspace', workspace.id] })
      router.replace('/platform/workspaces')
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Delete workspace</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-sm text-secondary">
          For test or unwanted workspaces. It disappears at once for its members and from this
          console; its data is kept, not purged. Disconnect its WhatsApp number first. The internal
          workspace cannot be deleted.
        </p>
        <Button variant="danger" onClick={() => setOpen(true)}>
          Delete workspace
        </Button>
      </CardContent>
      <DetailDrawer
        open={open}
        onOpenChange={(v) => {
          if (busy) return
          setOpen(v)
          if (!v) {
            setConfirmName('')
            setReason('')
            setError(null)
          }
        }}
        title={`Delete ${workspace.name}?`}
        description="Members lose access immediately. This is recorded in the audit log. Restoring needs a database change."
      >
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field
            label="Type the workspace name to confirm"
            hint={workspace.name}
            required
            error={fieldError(error, 'confirmName')}
          >
            <Input
              required
              autoComplete="off"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
            />
          </Field>
          <Field
            label="Reason"
            required
            hint="At least 5 characters, for example: duplicate test workspace."
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
          <Button
            type="submit"
            variant="danger"
            loading={busy}
            disabled={confirmName.trim() !== workspace.name || reason.trim().length < 5}
          >
            Delete workspace
          </Button>
        </form>
      </DetailDrawer>
    </Card>
  )
}

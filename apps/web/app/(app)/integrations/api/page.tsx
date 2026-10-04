'use client'

import {
  API_KEY_SCOPES,
  type ApiKey,
  type ApiKeyScope,
  type CreatedApiKey,
  PERMISSIONS,
} from '@fenwira/contracts'
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  DetailDrawer,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Label,
  ListPage,
  Modal,
  ModalClose,
  ModalContent,
  PermissionState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusBadge,
  toast,
  useConfirm,
} from '@fenwira/ui'
import { Check, Copy, Key, Plus } from 'lucide-react'
import Link from 'next/link'
import { type FormEvent, useState } from 'react'
import { FormError } from '@/components/auth/form-error'
import { useSession } from '@/components/session/session-provider'
import { useApiEntitled, useApiKeys, useCreateApiKey, useRevokeApiKey } from '@/lib/api-keys'
import { relativeTime } from '@/lib/relative-time'

const EXPIRATION_OPTIONS = [
  { value: 'never', label: 'Never' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
] as const

function expiresAtFromChoice(choice: string): string | undefined {
  if (choice === 'never') return undefined
  const days = Number(choice)
  return new Date(Date.now() + days * 24 * 3600 * 1000).toISOString()
}

function keyStatus(key: ApiKey): 'REVOKED' | 'EXPIRED' | 'ACTIVE' {
  if (key.revokedAt) return 'REVOKED'
  if (key.expiresAt && new Date(key.expiresAt) < new Date()) return 'EXPIRED'
  return 'ACTIVE'
}

/** Short chip label for a scope, e.g. "Contacts: read" rather than the raw permission key. */
function scopeChipLabel(scope: ApiKeyScope): string {
  const resource = scope.split('.')[0] ?? scope
  const verb = scope.endsWith('.write') ? 'write' : scope.endsWith('.reply') ? 'reply' : 'read'
  return `${resource.charAt(0).toUpperCase()}${resource.slice(1)}: ${verb}`
}

/** Create API key → shows the secret exactly once (docs/API_KEYS.md → One-time secret display). */
function CreateApiKeyDialog({
  open,
  onOpenChange,
  grantableScopes,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  grantableScopes: ApiKeyScope[]
  onCreated: (created: CreatedApiKey) => void
}) {
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<Set<ApiKeyScope>>(new Set())
  const [expiration, setExpiration] = useState<string>('never')
  const create = useCreateApiKey()

  const reset = () => {
    setName('')
    setScopes(new Set())
    setExpiration('never')
    create.reset()
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <ModalContent
        title="Create API key"
        description="Grant only the scopes this integration actually needs."
        footer={
          <>
            <ModalClose asChild>
              <Button variant="secondary">Cancel</Button>
            </ModalClose>
            <Button
              type="submit"
              form="create-api-key-form"
              loading={create.isPending}
              disabled={!name.trim() || scopes.size === 0}
            >
              Create key
            </Button>
          </>
        }
      >
        <form
          id="create-api-key-form"
          className="flex flex-col gap-5"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            create.mutate(
              {
                name: name.trim(),
                scopes: [...scopes],
                ...(expiresAtFromChoice(expiration)
                  ? { expiresAt: expiresAtFromChoice(expiration) }
                  : {}),
              },
              { onSuccess: (created) => onCreated(created) },
            )
          }}
        >
          <FormError error={create.error} />
          <Field label="Name" hint="So you and your team can tell integrations apart.">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Lenz integration"
              required
              autoFocus
            />
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-slate">Permissions</legend>
            <div className="flex flex-col gap-2 rounded-md border border-border p-3">
              {grantableScopes.map((scope) => (
                <label key={scope} className="flex items-center gap-2.5 text-base text-slate">
                  <Checkbox
                    checked={scopes.has(scope)}
                    onCheckedChange={(checked) =>
                      setScopes((prev) => {
                        const next = new Set(prev)
                        if (checked) next.add(scope)
                        else next.delete(scope)
                        return next
                      })
                    }
                  />
                  {PERMISSIONS[scope]}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="api-key-expiration">Expiration</Label>
            <Select value={expiration} onValueChange={setExpiration}>
              <SelectTrigger id="api-key-expiration">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPIRATION_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
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

/** The secret, shown exactly once. Closing this dialog is the point of no return. */
function RevealSecretDialog({
  created,
  onClose,
}: {
  created: CreatedApiKey | null
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  if (!created) return null
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(created.secret)
      setCopied(true)
      toast.success('API key copied')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Couldn't copy — select and copy the key manually.")
    }
  }
  return (
    <Modal open onOpenChange={(next) => !next && onClose()}>
      <ModalContent
        title="API key created"
        hideClose
        footer={<Button onClick={onClose}>Done</Button>}
      >
        <div className="flex flex-col gap-4">
          <p className="text-base font-medium text-danger-strong">
            Copy this key now. Fenwira will not show it again.
          </p>
          <div className="flex items-center gap-2 rounded-md border border-border bg-background p-3">
            <code className="min-w-0 flex-1 overflow-x-auto font-mono text-sm text-slate">
              {created.secret}
            </code>
            <Button type="button" variant="secondary" size="sm" onClick={copy}>
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy API key'}
            </Button>
          </div>
          <p className="text-sm text-muted">
            "{created.key.name}" is ready to use. If this key is lost, revoke it and create a new
            one — Fenwira stores only a hash and cannot recover it.
          </p>
        </div>
      </ModalContent>
    </Modal>
  )
}

function ApiKeyDetailDrawer({ apiKey, onClose }: { apiKey: ApiKey | null; onClose: () => void }) {
  return (
    <DetailDrawer
      open={!!apiKey}
      onOpenChange={(open) => !open && onClose()}
      title={apiKey?.name ?? ''}
      description={apiKey ? `fw_${apiKey.prefix}_••••••` : undefined}
    >
      {apiKey ? (
        <dl className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <dt className="text-sm text-muted">Status</dt>
            <dd>
              <StatusBadge status={keyStatus(apiKey)} />
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-sm text-muted">Permissions</dt>
            <dd className="flex flex-wrap gap-1.5">
              {apiKey.scopes.map((s) => (
                <Badge key={s} tone="neutral">
                  {scopeChipLabel(s)}
                </Badge>
              ))}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-sm text-muted">Created</dt>
            <dd className="text-slate">
              {new Date(apiKey.createdAt).toLocaleDateString()}
              {apiKey.createdByName ? ` by ${apiKey.createdByName}` : ''}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-sm text-muted">Expires</dt>
            <dd className="text-slate">
              {apiKey.expiresAt ? new Date(apiKey.expiresAt).toLocaleDateString() : 'Never'}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-sm text-muted">Last used</dt>
            <dd className="text-slate">
              {apiKey.lastUsedAt ? relativeTime(apiKey.lastUsedAt) : 'Never'}
            </dd>
          </div>
        </dl>
      ) : null}
    </DetailDrawer>
  )
}

export default function ApiKeysPage() {
  const { can, membership } = useSession()
  const list = useApiKeys()
  const entitled = useApiEntitled().data ?? true
  const revoke = useRevokeApiKey()
  const confirm = useConfirm()
  const [createOpen, setCreateOpen] = useState(false)
  const [created, setCreated] = useState<CreatedApiKey | null>(null)
  const [managing, setManaging] = useState<ApiKey | null>(null)

  if (!can('integrations.manage'))
    return <PermissionState what="API keys" permission="integrations.manage" />

  const grantableScopes = API_KEY_SCOPES.filter((s) => membership.permissions.includes(s))

  const onRevoke = async (key: ApiKey) => {
    const ok = await confirm({
      title: `Revoke "${key.name}"?`,
      destructive: true,
      impact: [
        'Any integration using this key will immediately stop authenticating.',
        'This cannot be undone — a revoked key can never be reactivated.',
      ],
      confirmLabel: 'Revoke key',
    })
    if (!ok) return
    try {
      await revoke.mutateAsync(key.id)
      toast.success(`"${key.name}" revoked`)
    } catch {
      toast.error('Could not revoke the key. Try again.')
    }
  }

  return (
    <ListPage
      header={{
        title: 'API',
        description: 'Build secure integrations with your Fenwira workspace.',
        actions: entitled ? (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden="true" />
            Create API key
          </Button>
        ) : null,
      }}
      banner={
        entitled ? null : (
          <Alert tone="warning" title="API access isn’t included in your current plan">
            Existing keys are kept and can still be revoked, but requests made with them are refused
            until the API is available again.{' '}
            <Link href="/billing/subscription" className="font-medium underline underline-offset-4">
              View subscription
            </Link>
          </Alert>
        )
      }
    >
      {list.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : list.isError ? (
        <ErrorState onRetry={() => list.refetch()} />
      ) : !list.data?.length ? (
        <EmptyState
          icon={<Key aria-hidden="true" />}
          title="No API keys yet"
          description="API keys let external systems — your own tools, Lenz, a script — call the Fenwira API as this workspace, scoped to only the permissions they need."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus aria-hidden="true" />
              Create API key
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {list.data.map((key) => (
            <Card key={key.id} className="p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-slate">{key.name}</h3>
                    <StatusBadge status={keyStatus(key)} />
                  </div>
                  <code className="font-mono text-sm text-muted">fw_{key.prefix}_••••••</code>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {key.scopes.map((s) => (
                      <Badge key={s} tone="neutral">
                        {scopeChipLabel(s)}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-sm text-muted">
                    {key.lastUsedAt ? `Last used ${relativeTime(key.lastUsedAt)}` : 'Never used'} ·
                    Created {new Date(key.createdAt).toLocaleDateString()} · Expires{' '}
                    {key.expiresAt ? new Date(key.expiresAt).toLocaleDateString() : 'Never'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setManaging(key)}>
                    Manage
                  </Button>
                  {key.revokedAt ? null : (
                    <Button
                      variant="danger"
                      size="sm"
                      loading={revoke.isPending}
                      onClick={() => onRevoke(key)}
                    >
                      Revoke
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      <CreateApiKeyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        grantableScopes={grantableScopes}
        onCreated={(c) => {
          setCreateOpen(false)
          setCreated(c)
        }}
      />
      <RevealSecretDialog created={created} onClose={() => setCreated(null)} />
      <ApiKeyDetailDrawer apiKey={managing} onClose={() => setManaging(null)} />
    </ListPage>
  )
}

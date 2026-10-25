'use client'
import {
  managedConnectRequestSchema,
  metaHealthSchema,
  plainFieldErrors,
  managedRotateRequestSchema,
  platformWhatsAppConnectionSchema,
  templateSyncSummarySchema,
  verifyConnectionResultSchema,
  type PlatformWhatsAppConnection,
  type VerifyConnectionResult,
} from '@fenwira/contracts'
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailDrawer,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Skeleton,
  StatusBadge,
  SummaryItem,
  toast,
  useConfirm,
} from '@fenwira/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { z } from 'zod'
import { FormError } from '@/components/auth/form-error'
import { ApiError, errorText } from '@/lib/api/client'
import { isMetaTestNumber } from '@/lib/phone'
import { platformRequest } from '@/lib/platform'
import { useIdentityRequest } from './identity'
import { usePlatform } from './platform-shell'

type Action = 'verify' | 'sync' | 'sync-templates' | 'subscribe' | 'disconnect'

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'Never')
const failure = (err: unknown) => errorText(err, 'The request failed. Try again.')

/**
 * ADR-0027 Managed Launch Mode: the operator connects and maintains a customer's Meta connection.
 * Tokens and app secrets are typed into password fields, sent once, cleared from state right away
 * and only ever shown back masked.
 */
export function WorkspaceWhatsApp({ workspaceId, name }: { workspaceId: string; name: string }) {
  const request = useIdentityRequest()
  const me = usePlatform()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const canManage = me?.permissions.includes('whatsapp.manage') ?? false
  const base = `/workspaces/${workspaceId}/whatsapp/connections`
  const key = ['platform', 'whatsapp', workspaceId]
  const connections = useQuery({
    queryKey: key,
    enabled: me?.permissions.includes('whatsapp.read') ?? false,
    retry: false,
    queryFn: async () =>
      z.array(platformWhatsAppConnectionSchema).parse(await platformRequest(base)),
  })
  const [connectOpen, setConnectOpen] = useState(false)
  const [rotating, setRotating] = useState<PlatformWhatsAppConnection | null>(null)
  const [busy, setBusy] = useState<{ id: string; action: Action } | null>(null)
  const [verified, setVerified] = useState<Record<string, VerifyConnectionResult>>({})
  const refresh = () => void queryClient.invalidateQueries({ queryKey: key })

  async function act(c: PlatformWhatsAppConnection, action: Action) {
    if (
      action === 'disconnect' &&
      !(await confirm({
        title: `Disconnect ${c.displayPhoneNumber}?`,
        description: `Workspace ${name} stops sending and receiving on this number.`,
        impact: [
          'Webhooks for this number are rejected from now on.',
          'The access token and app secret are wiped from Fenwira.',
        ],
        confirmLabel: 'Disconnect number',
        destructive: true,
      }))
    )
      return
    setBusy({ id: c.id, action })
    try {
      if (action === 'verify') {
        const result = verifyConnectionResultSchema.parse(
          await request(`${base}/${c.id}/verify`, {}),
        )
        setVerified((v) => ({ ...v, [c.id]: result }))
        if (result.ok) toast.success('Connection verified with Meta')
        else toast.error('Meta rejected at least one check')
      } else if (action === 'sync-templates') {
        const s = templateSyncSummarySchema.parse(
          await request(`${base}/${c.id}/sync-templates`, {}),
        )
        toast.success(`Templates synced: ${s.imported} new, ${s.updated} updated`)
      } else if (action === 'disconnect') {
        await request(`${base}/${c.id}`, undefined, 'DELETE')
        toast.success(`${c.displayPhoneNumber} disconnected`)
      } else {
        await request(`${base}/${c.id}/${action}`, {})
        toast.success(action === 'sync' ? 'Status synced from Meta' : 'Webhooks subscribed')
      }
    } catch (err) {
      toast.error(failure(err))
    } finally {
      setBusy(null)
      refresh()
    }
  }

  if (!(me?.permissions.includes('whatsapp.read') ?? false)) return null
  return (
    <section aria-labelledby="whatsapp-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="whatsapp-heading" className="text-lg font-semibold">
          WhatsApp connection
        </h2>
        {canManage ? (
          <Button onClick={() => setConnectOpen(true)}>Connect WhatsApp number</Button>
        ) : null}
      </div>
      <p className="text-sm text-secondary">
        Managed connection (ADR-0027): a permanent system-user token and the app secret of the Meta
        app that sends this WABA&apos;s webhooks. Meta bills conversation charges to the
        customer&apos;s own Meta payment method.
      </p>
      {connections.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : connections.isError ? (
        <ErrorState onRetry={() => void connections.refetch()} />
      ) : connections.data.length === 0 ? (
        <EmptyState
          title="No WhatsApp number connected"
          description="Collect the customer's WABA ID, phone number ID, display number, system-user token and app secret, then connect."
        />
      ) : (
        connections.data.map((c) => (
          <ConnectionPanel
            key={c.id}
            c={c}
            base={base}
            canManage={canManage}
            busy={busy?.id === c.id ? busy.action : undefined}
            lastVerify={verified[c.id]}
            onAction={(a) => void act(c, a)}
            onRotate={() => setRotating(c)}
          />
        ))
      )}
      <ConnectDrawer
        open={connectOpen}
        onOpenChange={setConnectOpen}
        workspaceName={name}
        path={base}
        onDone={refresh}
      />
      <RotateDrawer
        connection={rotating}
        onOpenChange={(open) => !open && setRotating(null)}
        path={base}
        onDone={refresh}
      />
    </section>
  )
}

function ConnectionPanel({
  c,
  base,
  canManage,
  busy,
  lastVerify,
  onAction,
  onRotate,
}: {
  c: PlatformWhatsAppConnection
  base: string
  canManage: boolean
  busy?: Action
  lastVerify?: VerifyConnectionResult
  onAction: (a: Action) => void
  onRotate: () => void
}) {
  const cred = c.credential
  return (
    <Card role="region" aria-label={`WhatsApp number ${c.displayPhoneNumber}`}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <CardTitle as="h3">{c.displayPhoneNumber}</CardTitle>
          <p className="text-sm text-muted">
            {c.verifiedName} · WABA {c.waba.id} · number {c.phoneNumberId}
          </p>
        </div>
        <StatusBadge status={c.status} />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {c.status === 'DISCONNECTED' ? null : <MetaHealthPanel path={`${base}/${c.id}/health`} />}
        {cred?.verifyOk === false ? (
          <Alert tone="danger" title="Last verification failed">
            Error code {cred.verifyErrorCode ?? 'unknown'}. Rotate the token or check the
            customer&apos;s Meta setup, then verify again.
          </Alert>
        ) : null}
        {lastVerify ? (
          <ul className="flex flex-col gap-1 text-sm" aria-label="Verification checks">
            {(
              [
                ['Token', lastVerify.checks.token],
                ['Phone number lookup', lastVerify.checks.phoneNumber],
                ['WABA access', lastVerify.checks.waba],
              ] as const
            ).map(([label, check]) => (
              <li key={label} className="flex flex-wrap items-center gap-2">
                <StatusBadge status={check.ok ? 'SUCCEEDED' : 'FAILED'} label={label} />
                {check.error ? (
                  <span className="text-secondary">
                    {check.error.code}: {check.error.message}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryItem label="Quality">
            <StatusBadge status={c.qualityRating} />
          </SummaryItem>
          <SummaryItem label="Messaging limit">
            {c.messagingLimitTier ?? 'Not reported'}
          </SummaryItem>
          <SummaryItem label="Webhooks">
            {c.webhookStatus === 'ACTIVE' || c.webhookStatus === 'FAILED' ? (
              <StatusBadge status={c.webhookStatus} />
            ) : (
              'Not subscribed'
            )}
          </SummaryItem>
          <SummaryItem label="Access token">
            {cred ? (
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm">{cred.maskedToken}</span>
                <StatusBadge status={cred.status} />
              </span>
            ) : (
              'None'
            )}
          </SummaryItem>
          <SummaryItem label="App secret">
            {c.appSecret ? (
              <span className="font-mono text-sm">{c.appSecret.maskedSecret}</span>
            ) : (
              'Platform app'
            )}
          </SummaryItem>
          <SummaryItem label="Meta app / business">
            {c.metaAppId ?? '—'} / {c.businessId ?? '—'}
          </SummaryItem>
          <SummaryItem label="Last verified">{when(cred?.verifiedAt ?? null)}</SummaryItem>
          <SummaryItem label="Status synced / templates synced">
            {when(c.lastSyncedAt)} / {when(c.templatesSyncedAt)}
          </SummaryItem>
        </dl>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={busy === 'verify'} onClick={() => onAction('verify')}>
              Verify connection
            </Button>
            <Button
              size="sm"
              variant="secondary"
              loading={busy === 'sync'}
              onClick={() => onAction('sync')}
            >
              Sync status & quality
            </Button>
            <Button
              size="sm"
              variant="secondary"
              loading={busy === 'sync-templates'}
              onClick={() => onAction('sync-templates')}
            >
              Sync templates
            </Button>
            <Button
              size="sm"
              variant="secondary"
              loading={busy === 'subscribe'}
              onClick={() => onAction('subscribe')}
            >
              Subscribe webhooks
            </Button>
            <Button size="sm" variant="secondary" onClick={onRotate}>
              Rotate credentials
            </Button>
            <Button
              size="sm"
              variant="danger"
              loading={busy === 'disconnect'}
              onClick={() => onAction('disconnect')}
            >
              Disconnect
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

const EMPTY = {
  wabaId: '',
  phoneNumberId: '',
  displayPhoneNumber: '',
  accessToken: '',
  appSecret: '',
  appId: '',
  businessId: '',
}

function ConnectDrawer({
  open,
  onOpenChange,
  workspaceName,
  path,
  onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  workspaceName: string
  path: string
  onDone: () => void
}) {
  const request = useIdentityRequest()
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [fields, setFields] = useState<Record<string, string>>({})
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [k]: e.target.value }))
    setFields(({ [k]: _, ...rest }) => rest)
  }
  const test = isMetaTestNumber(form.displayPhoneNumber)
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setFields({})
    try {
      // Checked here first, so Meta is only called with well-formed values.
      const parsed = managedConnectRequestSchema.safeParse(
        Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim() !== '')),
      )
      if (!parsed.success) {
        setFields(
          Object.fromEntries(
            plainFieldErrors(parsed.error.issues).map((f) => [f.path, f.message] as const),
          ),
        )
        return
      }
      await request(path, parsed.data)
      toast.success(`${parsed.data.displayPhoneNumber} connected to ${workspaceName}`)
      setForm(EMPTY)
      onOpenChange(false)
      onDone()
    } catch (err) {
      setError(err)
      if (err instanceof ApiError && err.fieldErrors)
        setFields(Object.fromEntries(err.fieldErrors.map((f) => [f.path, f.message] as const)))
    } finally {
      // Secrets never stay in memory longer than the request.
      setForm((f) => ({ ...f, accessToken: '', appSecret: '' }))
      setBusy(false)
    }
  }
  return (
    <DetailDrawer
      open={open}
      onOpenChange={(v) => {
        if (!busy) {
          if (!v) setForm(EMPTY)
          onOpenChange(v)
        }
      }}
      title="Connect WhatsApp number"
      description={`For ${workspaceName}. The token and app secret are encrypted and never shown again.`}
    >
      <form onSubmit={submit} className="flex flex-col gap-4" autoComplete="off">
        <Field label="WABA ID" required error={fields.wabaId}>
          <Input required inputMode="numeric" value={form.wabaId} onChange={set('wabaId')} />
        </Field>
        <Field label="Phone number ID" required error={fields.phoneNumberId}>
          <Input
            required
            inputMode="numeric"
            value={form.phoneNumberId}
            onChange={set('phoneNumberId')}
          />
        </Field>
        <Field
          label="Display phone number"
          hint="As shown in WhatsApp Manager, for example +91 98765 43210"
          required
          error={fields.displayPhoneNumber}
        >
          <Input required value={form.displayPhoneNumber} onChange={set('displayPhoneNumber')} />
        </Field>
        <Field
          label="System-user access token"
          hint="Permanent token, never expiring"
          required
          error={fields.accessToken}
        >
          <Input
            required
            type="password"
            autoComplete="new-password"
            value={form.accessToken}
            onChange={set('accessToken')}
          />
        </Field>
        <Field
          label="App secret"
          hint="Of the Meta app that sends this WABA's webhooks"
          error={fields.appSecret}
        >
          <Input
            type="password"
            autoComplete="new-password"
            value={form.appSecret}
            onChange={set('appSecret')}
          />
        </Field>
        <Field label="Meta app ID" error={fields.appId}>
          <Input inputMode="numeric" value={form.appId} onChange={set('appId')} />
        </Field>
        <Field label="Business portfolio ID" error={fields.businessId}>
          <Input inputMode="numeric" value={form.businessId} onChange={set('businessId')} />
        </Field>
        {test ? (
          <Alert tone="info" title="Meta test number">
            Test numbers (+1 555…) are already registered by Meta, so Fenwira skips registration.
            They can only message the recipient numbers added under WhatsApp → API Setup in the Meta
            app, and they are not for real customer traffic.
          </Alert>
        ) : null}
        <FormError error={error} />
        <Button type="submit" loading={busy}>
          Connect and verify
        </Button>
      </form>
    </DetailDrawer>
  )
}

function RotateDrawer({
  connection,
  onOpenChange,
  path,
  onDone,
}: {
  connection: PlatformWhatsAppConnection | null
  onOpenChange: (v: boolean) => void
  path: string
  onDone: () => void
}) {
  const request = useIdentityRequest()
  const [accessToken, setToken] = useState('')
  const [appSecret, setSecret] = useState('')
  const [appId, setAppId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const reset = () => {
    setToken('')
    setSecret('')
    setAppId('')
    setError('')
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!connection) return
    setBusy(true)
    setError('')
    try {
      const parsed = managedRotateRequestSchema.safeParse({
        ...(accessToken ? { accessToken } : {}),
        ...(appSecret ? { appSecret } : {}),
        ...(appId ? { appId } : {}),
      })
      if (!parsed.success) {
        setError(parsed.error.issues.map((i) => i.message).join(' · '))
        return
      }
      await request(`${path}/${connection.id}/rotate`, parsed.data)
      toast.success('Credentials rotated')
      reset()
      onOpenChange(false)
      onDone()
    } catch (err) {
      setError(failure(err))
    } finally {
      setToken('')
      setSecret('')
      setBusy(false)
    }
  }
  return (
    <DetailDrawer
      open={connection !== null}
      onOpenChange={(v) => {
        if (!busy) {
          if (!v) reset()
          onOpenChange(v)
        }
      }}
      title="Rotate credentials"
      description={
        connection
          ? `${connection.displayPhoneNumber}. Fill only what changes; a new token is verified before it replaces the old one.`
          : undefined
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" autoComplete="off">
        <Field label="New system-user access token">
          <Input
            type="password"
            autoComplete="new-password"
            value={accessToken}
            onChange={(e) => setToken(e.target.value)}
          />
        </Field>
        <Field label="New app secret">
          <Input
            type="password"
            autoComplete="new-password"
            value={appSecret}
            onChange={(e) => setSecret(e.target.value)}
          />
        </Field>
        <Field label="Meta app ID">
          <Input inputMode="numeric" value={appId} onChange={(e) => setAppId(e.target.value)} />
        </Field>
        {error ? (
          <Alert tone="danger" title="Not rotated">
            {error}
          </Alert>
        ) : null}
        <Button type="submit" loading={busy}>
          Rotate
        </Button>
      </form>
    </DetailDrawer>
  )
}

const HEALTH_BADGE = {
  AVAILABLE: { status: 'CONNECTED', label: 'Meta: can send' },
  LIMITED: { status: 'ATTENTION', label: 'Meta: sending limited' },
  BLOCKED: { status: 'ERROR', label: 'Meta: sending blocked' },
  UNKNOWN: { status: 'INACTIVE', label: 'Meta: status unknown' },
} as const

/**
 * Meta's live messaging health (number, WABA, business portfolio, app). Shows why Meta refuses
 * to send, e.g. an unverified business portfolio, with Meta's own suggested fix.
 */
function MetaHealthPanel({ path }: { path: string }) {
  const health = useQuery({
    queryKey: ['platform', 'whatsapp-health', path],
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: async () => metaHealthSchema.parse(await platformRequest(path)),
  })
  return (
    <section aria-label="Meta messaging health" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {health.isPending ? (
          <span className="text-sm text-secondary">Checking Meta health…</span>
        ) : health.isError ? (
          <span className="text-sm text-secondary">
            Meta health unavailable: {errorText(health.error, 'Meta did not answer.')}
          </span>
        ) : (
          <>
            <StatusBadge {...HEALTH_BADGE[health.data.canSend]} />
            <span className="text-sm text-secondary">
              Checked {new Date(health.data.checkedAt).toLocaleTimeString()}
            </span>
          </>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={health.isFetching}
          onClick={() => void health.refetch()}
        >
          Check again
        </Button>
      </div>
      {health.data?.problems.length ? (
        <Alert
          tone={health.data.canSend === 'BLOCKED' ? 'danger' : 'warning'}
          title={`Meta ${health.data.canSend === 'BLOCKED' ? 'blocks' : 'limits'} sending from this number`}
        >
          <ul className="flex flex-col gap-2">
            {health.data.problems.map((p, i) => (
              <li key={i}>
                <span className="font-medium">{p.level}</span>
                {p.code ? ` (${p.code})` : ''}: {p.description}
                {p.solution ? <span className="block text-sm">Fix: {p.solution}</span> : null}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
    </section>
  )
}

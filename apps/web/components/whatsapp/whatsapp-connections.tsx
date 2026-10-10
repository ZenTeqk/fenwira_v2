'use client'

import {
  type ConnectionStep,
  type WhatsAppConnection,
  type WhatsAppSignupConfig,
} from '@fenwira/contracts'
import {
  Alert,
  Button,
  EmptyState,
  ErrorState,
  PermissionState,
  SettingsPage,
  Skeleton,
  toast,
  useConfirm,
} from '@fenwira/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageCircle, Plus, Wrench } from 'lucide-react'
import { useState } from 'react'
import { useSession } from '@/components/session/session-provider'
import { ApiError, del, get, patch, post } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { launchEmbeddedSignup } from '@/lib/facebook-sdk'
import { type ConnectionAction, ConnectionCard } from './connection-card'
import { DevConnectModal } from './dev-connect-modal'
import { RenameModal, RotateTokenModal } from './manage-modals'
import { ConnectionSteps } from './steps'
import { TestConnectionModal } from './test-modal'

const message = (err: unknown) => (err instanceof ApiError ? err.message : String(err))

/** Settings → WhatsApp and Integrations → WhatsApp (same screen, two entry points). */
export function WhatsAppConnections() {
  const { tenantId, can } = useSession()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const canManage = can('whatsapp.manage')
  const [devOpen, setDevOpen] = useState(false)
  const [testing, setTesting] = useState<WhatsAppConnection | null>(null)
  const [renaming, setRenaming] = useState<WhatsAppConnection | null>(null)
  const [rotating, setRotating] = useState<WhatsAppConnection | null>(null)
  const [signupFailure, setSignupFailure] = useState<{
    message: string
    steps?: ConnectionStep[]
  } | null>(null)
  const [busy, setBusy] = useState<{ id: string; action: ConnectionAction } | null>(null)

  const listKey = keys.tenant(tenantId, 'whatsapp-connections')
  const connections = useQuery({
    queryKey: listKey,
    queryFn: () => get<{ data: WhatsAppConnection[] }>('/whatsapp/connections').then((r) => r.data),
    enabled: can('whatsapp.read'),
  })
  const config = useQuery({
    queryKey: keys.tenant(tenantId, 'whatsapp-signup-config'),
    queryFn: () =>
      get<{ data: WhatsAppSignupConfig }>('/config/whatsapp-signup').then((r) => r.data),
    enabled: canManage,
    staleTime: Infinity,
  })
  const refresh = () => void queryClient.invalidateQueries({ queryKey: listKey })
  const connected = (c: WhatsAppConnection) => {
    refresh()
    if (c.status === 'ERROR') toast.error(`${c.displayPhoneNumber} needs attention`)
    else toast.success(`${c.displayPhoneNumber} is connected`)
  }

  const signup = useMutation({
    mutationFn: async () => {
      setSignupFailure(null)
      const result = await launchEmbeddedSignup(config.data!)
      return post<{ data: WhatsAppConnection }>('/whatsapp/connections', result)
    },
    onSuccess: (res) => connected(res.data),
    onError: (err) =>
      setSignupFailure({
        message: message(err),
        steps:
          err instanceof ApiError
            ? (err.details?.steps as ConnectionStep[] | undefined)
            : undefined,
      }),
  })

  const act = useMutation({
    mutationFn: async ({ c, action }: { c: WhatsAppConnection; action: ConnectionAction }) => {
      setBusy({ id: c.id, action })
      const base = `/whatsapp/connections/${c.id}`
      if (action === 'sync') await post(`${base}/sync`)
      if (action === 'retry') await post(`${base}/retry`)
      if (action === 'default') await patch(base, { isDefault: true })
      if (action === 'disconnect') await del(base)
      if (action === 'rotate') {
        const { code } = await launchEmbeddedSignup(config.data!)
        await post(`${base}/rotate-token`, { code })
      }
      return action
    },
    onSuccess: (action, { c }) => {
      const done: Partial<Record<ConnectionAction, string>> = {
        sync: 'Synced with Meta',
        default: `${c.displayPhoneNumber} is now the default number`,
        disconnect: `${c.displayPhoneNumber} was disconnected`,
        rotate: 'Token rotated',
      }
      if (done[action]) toast.success(done[action])
    },
    onError: (err) => toast.error(message(err)),
    onSettled: () => {
      setBusy(null)
      refresh()
    },
  })

  const onAction = async (c: WhatsAppConnection, action: ConnectionAction) => {
    if (action === 'test') return setTesting(c)
    if (action === 'rename') return setRenaming(c)
    if (action === 'rotate' && (c.credential?.tokenType === 'DEV' || !config.data?.embeddedSignup))
      return setRotating(c)
    if (
      action === 'disconnect' &&
      !(await confirm({
        title: `Disconnect ${c.displayPhoneNumber}?`,
        description: 'You can connect it again later.',
        impact: [
          'Fenwira stops sending and receiving messages on this number.',
          'Running campaigns that use it pause; automations can’t reply from it.',
          'Its access token is deleted from Fenwira.',
        ],
        confirmLabel: 'Disconnect number',
        destructive: true,
      }))
    )
      return
    act.mutate({ c, action })
  }

  if (!can('whatsapp.read')) return <PermissionState what="WhatsApp connections" />

  const embedded = config.data?.embeddedSignup ?? false
  const actions = canManage ? (
    <div className="flex flex-wrap gap-2">
      {config.data?.devConnect ? (
        <Button variant="secondary" onClick={() => setDevOpen(true)}>
          <Wrench aria-hidden="true" />
          Developer connect
        </Button>
      ) : null}
      {embedded ? (
        <Button onClick={() => signup.mutate()} loading={signup.isPending}>
          <Plus aria-hidden="true" />
          Connect WhatsApp
        </Button>
      ) : null}
    </div>
  ) : null

  return (
    <SettingsPage
      header={{
        title: 'WhatsApp',
        description:
          'Connect your WhatsApp Business numbers. Each number belongs to one workspace.',
        actions: actions,
      }}
    >
      {canManage && config.data && !embedded ? (
        <Alert tone="info" title="Embedded Signup isn't set up on this server">
          An administrator needs to add the Meta app ID, app secret and Embedded Signup
          configuration ID to the server environment.
          {config.data.devConnect ? ' Until then, use Developer connect with a test number.' : ''}
        </Alert>
      ) : null}
      {signupFailure ? (
        <Alert tone="danger" title={signupFailure.message}>
          {signupFailure.steps ? <ConnectionSteps steps={signupFailure.steps} /> : null}
        </Alert>
      ) : null}

      {connections.isPending ? (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading connections">
          <Skeleton className="h-56 w-full" />
        </div>
      ) : connections.isError ? (
        <ErrorState
          correlationId={
            connections.error instanceof ApiError ? connections.error.correlationId : undefined
          }
          onRetry={() => void connections.refetch()}
        />
      ) : connections.data.length === 0 ? (
        <EmptyState
          icon={<MessageCircle aria-hidden="true" />}
          title="No WhatsApp number connected"
          description={
            canManage
              ? 'Connect a WhatsApp Business number to start messaging customers.'
              : 'Ask a workspace admin to connect a WhatsApp Business number.'
          }
          action={actions}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {connections.data.map((c) => (
            <ConnectionCard
              key={c.id}
              connection={c}
              canManage={canManage}
              busy={busy?.id === c.id ? busy.action : undefined}
              onAction={(action) => void onAction(c, action)}
            />
          ))}
        </div>
      )}

      <DevConnectModal open={devOpen} onOpenChange={setDevOpen} onConnected={connected} />
      <TestConnectionModal
        connection={testing}
        onOpenChange={(open) => !open && setTesting(null)}
        onDone={refresh}
      />
      <RenameModal
        connection={renaming}
        onOpenChange={(open) => !open && setRenaming(null)}
        onSaved={() => {
          toast.success('Number renamed')
          refresh()
        }}
      />
      <RotateTokenModal
        connection={rotating}
        onOpenChange={(open) => !open && setRotating(null)}
        onSaved={() => {
          toast.success('Token rotated')
          refresh()
        }}
      />
    </SettingsPage>
  )
}

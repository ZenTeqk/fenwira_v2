'use client'
import { useState } from 'react'
import {
  type NativeConnection,
  type NativeConnectorCatalog,
  type NativeProvider,
  type NativeTransfer,
} from '@fenwira/contracts'
import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  Label,
  Modal,
  ModalContent,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusBadge,
  toast,
} from '@fenwira/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react'
import Link from 'next/link'
import { IntegrationLogo } from '@/components/integrations/integration-logo'
import { useSession } from '@/components/session/session-provider'
import { ApiError, del, get, post } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { relativeTime } from '@/lib/relative-time'
const labels: Record<NativeProvider, string> = {
  ERPNEXT: 'ERPNext',
  GOOGLE_SHEETS: 'Google Sheets',
  ZOHO_CRM: 'Zoho CRM',
  SHOPIFY: 'Shopify',
}
const message = (e: unknown) =>
  e instanceof ApiError ? e.message : 'The operation failed. Try again.'

export function NativeConnectors() {
  const { tenantId, can } = useSession()
  const cache = useQueryClient()
  const key = keys.tenant(tenantId, 'native-connectors')
  const catalog = useQuery({
    queryKey: key,
    queryFn: () =>
      get<{ data: NativeConnectorCatalog[] }>('/native-connectors').then((r) => r.data),
    enabled: can('integrations.manage'),
  })
  const [setup, setSetup] = useState<NativeProvider | null>(null)
  const [selected, setSelected] = useState<NativeConnection | null>(null)
  const [label, setLabel] = useState('')
  const [site, setSite] = useState('')
  const [region, setRegion] = useState('com')
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [disconnect, setDisconnect] = useState(false)
  const [transfer, setTransfer] = useState(false)
  const [spreadsheet, setSpreadsheet] = useState('')
  const [requestKey, setRequestKey] = useState('')
  const transferKey = keys.tenant(tenantId, 'native-transfers', selected?.id ?? 'none')
  const runs = useQuery({
    queryKey: transferKey,
    queryFn: () =>
      get<{ data: NativeTransfer[] }>(`/native-connectors/${selected!.id}/transfers`).then(
        (r) => r.data,
      ),
    enabled: !!selected && can('integrations.manage'),
    refetchInterval: 5000,
  })
  const invalidate = () => {
    void cache.invalidateQueries({ queryKey: key })
    void cache.invalidateQueries({ queryKey: transferKey })
  }
  const clear = () => {
    setSetup(null)
    setApiKey('')
    setApiSecret('')
  }
  const connect = useMutation({
    mutationFn: () =>
      post<{ data: { connection?: NativeConnection; authorizationUrl?: string; state?: string } }>(
        '/native-connectors/connect',
        {
          provider: setup,
          label,
          region,
          ...(site ? { site } : {}),
          ...(setup === 'ERPNEXT' ? { apiKey, apiSecret } : {}),
        },
      ),
    onSuccess: (r) => {
      if (r.data.authorizationUrl && r.data.state) {
        sessionStorage.setItem(
          'fenwira.native.authorization',
          JSON.stringify({ state: r.data.state, tenantId }),
        )
        window.location.assign(r.data.authorizationUrl)
      } else {
        clear()
        invalidate()
        toast.success('Application connected')
      }
    },
    onError: (e) => toast.error(message(e)),
  })
  const remove = useMutation({
    mutationFn: () => del(`/native-connectors/${selected!.id}`),
    onSuccess: () => {
      setDisconnect(false)
      setSelected(null)
      invalidate()
      toast.success('Application disconnected')
    },
    onError: (e) => toast.error(message(e)),
  })
  const start = useMutation({
    mutationFn: () =>
      post(`/native-connectors/${selected!.id}/transfers`, {
        idempotencyKey: requestKey,
        ...(selected?.provider === 'GOOGLE_SHEETS'
          ? { spreadsheetId: spreadsheet, confirmExport: true }
          : {}),
      }),
    onSuccess: () => {
      setTransfer(false)
      invalidate()
      toast.success(
        selected?.provider === 'GOOGLE_SHEETS'
          ? 'Export queued'
          : 'Contact import preparation queued',
      )
    },
    onError: (e) => toast.error(message(e)),
  })
  const retry = useMutation({
    mutationFn: (id: string) => post(`/native-connectors/${selected!.id}/transfers/${id}/retry`),
    onSuccess: () => {
      invalidate()
      toast.success('Transfer queued again')
    },
    onError: (e) => toast.error(message(e)),
  })
  if (!can('integrations.manage')) return null
  return (
    <section aria-labelledby="native-heading" className="flex flex-col gap-3">
      <div>
        <h2 id="native-heading" className="text-md font-semibold text-fg">
          Connected applications
        </h2>
        <p className="text-sm text-fg-secondary">
          Import CRM and store contacts, or export contacts to Google Sheets.
        </p>
      </div>
      {catalog.isPending ? (
        <Skeleton className="h-28" />
      ) : catalog.isError ? (
        <ErrorState title="Applications couldn’t load" onRetry={() => void catalog.refetch()} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {catalog.data.map((item) => (
            <Card key={item.provider} className="flex flex-col gap-3 p-3">
              <div className="flex items-center gap-3">
                <IntegrationLogo integration={item.provider} />
                <h3 className="text-sm font-semibold">{labels[item.provider]}</h3>
              </div>
              <p className="text-xs text-fg-secondary">
                {item.provider === 'GOOGLE_SHEETS'
                  ? 'Export contacts to a dedicated sheet'
                  : 'Import contacts for review'}
              </p>
              {item.connections.filter((c) => c.status === 'ACTIVE').length ? (
                <>
                  <StatusBadge status="ACTIVE" label="Connected" />
                  {item.connections
                    .filter((c) => c.status === 'ACTIVE')
                    .map((c) => (
                      <Button
                        key={c.id}
                        variant="secondary"
                        size="sm"
                        onClick={() => setSelected(c)}
                      >
                        {c.label}
                      </Button>
                    ))}
                </>
              ) : (
                <p className="text-xs text-fg-secondary">Not connected</p>
              )}
              {!item.available ? (
                <p className="text-xs text-fg-muted">OAuth app setup required</p>
              ) : null}
              <Button
                variant="secondary"
                size="sm"
                disabled={!item.available}
                onClick={() => {
                  setSetup(item.provider)
                  setLabel(labels[item.provider])
                  setSite('')
                  setRegion('com')
                  setApiKey('')
                  setApiSecret('')
                }}
              >
                Connect {labels[item.provider]}
              </Button>
              {item.connections
                .filter((c) => c.status === 'DISCONNECTED')
                .map((c) => (
                  <Button key={c.id} variant="link" size="sm" onClick={() => setSelected(c)}>
                    Previous transfers: {c.label}
                  </Button>
                ))}
            </Card>
          ))}
        </div>
      )}
      <Modal
        open={!!setup}
        onOpenChange={(open) => {
          if (!open && !connect.isPending) clear()
        }}
      >
        <ModalContent
          title={`Connect ${setup ? labels[setup] : 'application'}`}
          description={
            setup === 'ERPNEXT'
              ? 'Use an ERPNext API user with read access to Contacts. Credentials stay encrypted on the server.'
              : 'Authorize Fenwira securely with your provider account.'
          }
        >
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              connect.mutate()
            }}
          >
            <div>
              <Label htmlFor="native-label">Connection name</Label>
              <Input
                id="native-label"
                value={label}
                maxLength={80}
                required
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            {setup === 'ERPNEXT' || setup === 'SHOPIFY' ? (
              <div>
                <Label htmlFor="native-site">
                  {setup === 'SHOPIFY' ? 'Store domain' : 'ERPNext site URL'}
                </Label>
                <Input
                  id="native-site"
                  value={site}
                  required
                  placeholder={
                    setup === 'SHOPIFY' ? 'your-store.myshopify.com' : 'https://erp.example.com'
                  }
                  onChange={(e) => setSite(e.target.value)}
                />
              </div>
            ) : null}
            {setup === 'ZOHO_CRM' ? (
              <div>
                <Label htmlFor="native-region">Zoho account region</Label>
                <Select value={region} onValueChange={setRegion}>
                  <SelectTrigger id="native-region">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[
                      ['com', 'United States'],
                      ['in', 'India'],
                      ['eu', 'Europe'],
                      ['com.au', 'Australia'],
                      ['jp', 'Japan'],
                      ['ca', 'Canada'],
                      ['com.cn', 'China'],
                      ['sa', 'Saudi Arabia'],
                    ].map(([v, l]) => (
                      <SelectItem key={v} value={v!}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            {setup === 'ERPNEXT' ? (
              <>
                <div>
                  <Label htmlFor="native-api-key">API key</Label>
                  <Input
                    id="native-api-key"
                    type="password"
                    autoComplete="off"
                    value={apiKey}
                    required
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="native-api-secret">API secret</Label>
                  <Input
                    id="native-api-secret"
                    type="password"
                    autoComplete="new-password"
                    value={apiSecret}
                    required
                    onChange={(e) => setApiSecret(e.target.value)}
                  />
                </div>
              </>
            ) : null}
            <Button type="submit" loading={connect.isPending}>
              {setup === 'ERPNEXT' ? 'Verify and connect' : 'Continue to provider'}
            </Button>
          </form>
        </ModalContent>
      </Modal>
      <Modal
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      >
        <ModalContent
          title={selected?.label ?? 'Connection'}
          description={
            selected
              ? `${labels[selected.provider]} · ${selected.status === 'ACTIVE' ? 'Connected' : 'Disconnected'}`
              : undefined
          }
        >
          <div className="flex flex-col gap-3">
            {selected?.site ? (
              <p className="break-all text-sm text-fg-secondary">{selected.site}</p>
            ) : null}
            {selected?.status === 'ACTIVE' ? (
              <div className="flex flex-wrap gap-2">
                {can(
                  selected.provider === 'GOOGLE_SHEETS' ? 'contacts.export' : 'contacts.import',
                ) ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      setTransfer(true)
                      setRequestKey(crypto.randomUUID())
                      setSpreadsheet('')
                    }}
                  >
                    {selected.provider === 'GOOGLE_SHEETS' ? (
                      <ArrowUpFromLine aria-hidden="true" />
                    ) : (
                      <ArrowDownToLine aria-hidden="true" />
                    )}
                    {selected.provider === 'GOOGLE_SHEETS'
                      ? 'Export contacts'
                      : 'Prepare contact import'}
                  </Button>
                ) : null}
                <Button variant="secondary" size="sm" onClick={() => setDisconnect(true)}>
                  Disconnect
                </Button>
              </div>
            ) : null}
            <h3 className="text-sm font-semibold">Recent transfers</h3>
            {runs.isPending ? (
              <Skeleton className="h-20" />
            ) : runs.isError ? (
              <ErrorState onRetry={() => void runs.refetch()} />
            ) : !runs.data.length ? (
              <EmptyState title="No transfers yet" />
            ) : (
              <ul className="flex flex-col gap-2">
                {runs.data.map((run) => (
                  <li
                    key={run.id}
                    className="flex flex-col gap-2 rounded-md border border-border-subtle p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <StatusBadge status={run.status} />
                      <span className="text-xs text-fg-secondary">
                        {relativeTime(run.createdAt)}
                      </span>
                    </div>
                    <p className="text-sm">
                      {run.rows.toLocaleString('en-IN')} contacts{' '}
                      {run.importJobId ? 'prepared for review' : 'in snapshot'}
                    </p>
                    {run.errorCode ? (
                      <Alert tone="warning" title="Transfer needs attention">
                        {run.errorCode.replaceAll('_', ' ').toLowerCase()}. Check provider
                        permissions or reconnect before retrying.
                      </Alert>
                    ) : null}
                    {run.importJobId && can('contacts.import') ? (
                      <Button variant="link" size="sm" asChild>
                        <Link href={`/contacts/imports?job=${run.importJobId}`}>Review import</Link>
                      </Button>
                    ) : null}
                    {run.status !== 'SUCCEEDED' &&
                    selected?.status === 'ACTIVE' &&
                    can(
                      selected.provider === 'GOOGLE_SHEETS' ? 'contacts.export' : 'contacts.import',
                    ) ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={retry.isPending}
                        onClick={() => retry.mutate(run.id)}
                      >
                        Retry transfer
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {selected?.provider === 'GOOGLE_SHEETS' ? (
              <p className="text-xs text-fg-secondary">
                Each export creates a separate “Fenwira Contacts” tab named with its transfer ID.
                Retrying reuses that tab and snapshot.
              </p>
            ) : (
              <p className="text-xs text-fg-secondary">
                Imports require review and confirmation in Contacts. Provider consent is not
                imported.
              </p>
            )}
          </div>
        </ModalContent>
      </Modal>
      <ConfirmDialog
        open={disconnect}
        onOpenChange={setDisconnect}
        title="Disconnect application?"
        description="Remove the encrypted credentials from Fenwira. Imported contacts and previous transfer history remain."
        impact={[
          'New transfers stop. An external request already in progress may finish.',
          'Revoke access or uninstall the app in the provider to remove remote authorization.',
        ]}
        confirmLabel="Disconnect"
        onConfirm={() => remove.mutateAsync()}
        destructive
      />
      <Modal open={transfer} onOpenChange={setTransfer}>
        <ModalContent
          title={
            selected?.provider === 'GOOGLE_SHEETS'
              ? 'Export contacts to Google Sheets'
              : 'Prepare contact import'
          }
        >
          <div className="flex flex-col gap-3">
            {selected?.provider === 'GOOGLE_SHEETS' ? (
              <>
                <Alert tone="warning" title="Contact data leaves Fenwira">
                  Active contacts’ phone numbers, names, email addresses and IDs will be copied to
                  this spreadsheet. People with spreadsheet access can see this data. Fenwira
                  creates a dedicated new tab; other tabs are preserved.
                </Alert>
                <div>
                  <Label htmlFor="native-spreadsheet">Spreadsheet ID</Label>
                  <Input
                    id="native-spreadsheet"
                    value={spreadsheet}
                    onChange={(e) => setSpreadsheet(e.target.value)}
                  />
                </div>
              </>
            ) : (
              <p className="text-sm text-fg-secondary">
                Read contacts from this application and prepare a CSV for the existing import
                review. Choose field mapping and duplicate policy before confirming the import.
                Existing consent and suppression are preserved.
              </p>
            )}
            <Button
              loading={start.isPending}
              disabled={
                selected?.provider === 'GOOGLE_SHEETS' &&
                !/^[a-zA-Z0-9_-]{20,150}$/.test(spreadsheet)
              }
              onClick={() => start.mutate()}
            >
              {selected?.provider === 'GOOGLE_SHEETS' ? 'Confirm export' : 'Prepare import'}
            </Button>
          </div>
        </ModalContent>
      </Modal>
    </section>
  )
}

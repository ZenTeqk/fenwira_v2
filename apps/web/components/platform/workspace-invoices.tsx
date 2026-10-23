'use client'
import {
  createInvoiceRequestSchema,
  platformInvoiceSchema,
  type PlatformInvoice,
  voidInvoiceRequestSchema,
} from '@fenwira/contracts'
import {
  Alert,
  Button,
  DetailDrawer,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusBadge,
  type StatusKey,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
  useConfirm,
} from '@fenwira/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { z } from 'zod'
import { ApiError } from '@/lib/api/client'
import { platformMoney, platformRequest } from '@/lib/platform'
import { usePlatform } from './platform-shell'

const STATUS: Record<PlatformInvoice['displayStatus'], { status: StatusKey; label: string }> = {
  DUE: { status: 'PENDING', label: 'Due' },
  OVERDUE: { status: 'ATTENTION', label: 'Overdue' },
  PAYMENT_SUBMITTED: { status: 'PROCESSING', label: 'Proof submitted' },
  PAID: { status: 'COMPLETED', label: 'Paid' },
  VOID: { status: 'CANCELLED', label: 'Void' },
}
const failure = (err: unknown) =>
  err instanceof ApiError
    ? err.code === 'TOTP_REQUIRED'
      ? 'Verify your identity again (Commercial operations card), then retry.'
      : err.message
    : 'Request failed.'

/** "1499" or "1499.50" rupees → minor units; anything else is refused. */
function minorFrom(value: string): number | null {
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(value.trim())
  if (!m) return null
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
}

/** ADR-0027 manual UPI billing: a workspace's payment requests, issued and voided by an operator. */
export function WorkspaceInvoices({
  workspaceId,
  name,
  plans,
}: {
  workspaceId: string
  name: string
  plans: Array<{ key: string; name: string }>
}) {
  const me = usePlatform()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const canRead = me?.permissions.includes('payments.read') ?? false
  const canManage = me?.permissions.includes('payments.manage') ?? false
  const key = ['platform', 'invoices', workspaceId]
  const invoices = useQuery({
    queryKey: key,
    enabled: canRead,
    retry: false,
    queryFn: async () =>
      z
        .array(platformInvoiceSchema)
        .parse(await platformRequest(`/workspaces/${workspaceId}/invoices`)),
  })
  const [open, setOpen] = useState(false)
  const refresh = () => void queryClient.invalidateQueries({ queryKey: key })

  const [voiding, setVoiding] = useState<PlatformInvoice | null>(null)
  const [voidReason, setVoidReason] = useState('')
  async function voidInvoice(event: FormEvent) {
    event.preventDefault()
    const inv = voiding
    if (!inv) return
    const parsed = voidInvoiceRequestSchema.safeParse({ reason: voidReason })
    if (!parsed.success) return toast.error('Give a reason of at least 3 characters.')
    if (
      !(await confirm({
        title: `Void ${inv.number}?`,
        description: 'The customer can no longer pay it. This is recorded and cannot be undone.',
        confirmLabel: 'Void invoice',
        destructive: true,
      }))
    )
      return
    try {
      await platformRequest(`/workspaces/${workspaceId}/invoices/${inv.id}/void`, parsed.data)
      toast.success(`${inv.number} voided`)
      setVoiding(null)
      setVoidReason('')
    } catch (err) {
      toast.error(failure(err))
    } finally {
      refresh()
    }
  }

  if (!canRead) return null
  return (
    <section aria-labelledby="invoices-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="invoices-heading" className="text-lg font-semibold">
          Invoices
        </h2>
        {canManage ? <Button onClick={() => setOpen(true)}>Create invoice</Button> : null}
      </div>
      {invoices.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : invoices.isError ? (
        <ErrorState onRetry={() => void invoices.refetch()} />
      ) : invoices.data.length === 0 ? (
        <EmptyState title="No invoices" description="Create a plan renewal or a wallet top-up." />
      ) : (
        <Table containerLabel="Workspace invoices">
          <TableHeader>
            <TableRow>
              <TableHead>Reference</TableHead>
              <TableHead>For</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.data.map((inv) => (
              <TableRow key={inv.id}>
                <TableCell>
                  {inv.number}
                  {inv.receiptNumber ? (
                    <span className="block text-sm text-secondary">{inv.receiptNumber}</span>
                  ) : null}
                </TableCell>
                <TableCell>{inv.description}</TableCell>
                <TableCell>{platformMoney(inv.totalMinor, inv.currency)}</TableCell>
                <TableCell>{new Date(inv.dueAt).toLocaleDateString()}</TableCell>
                <TableCell>
                  <StatusBadge {...STATUS[inv.displayStatus]} />
                </TableCell>
                <TableCell>
                  {canManage &&
                  inv.status === 'OPEN' &&
                  inv.displayStatus !== 'PAYMENT_SUBMITTED' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setVoiding(inv)}
                      aria-label={`Void ${inv.number}`}
                    >
                      Void
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <DetailDrawer
        open={voiding !== null}
        onOpenChange={(v) => !v && setVoiding(null)}
        title={voiding ? `Void ${voiding.number}` : 'Void invoice'}
        description="The reason is kept in the audit trail."
      >
        <form onSubmit={(e) => void voidInvoice(e)} className="flex flex-col gap-4">
          <Field label="Reason" required>
            <Input required value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
          </Field>
          <Button type="submit" variant="danger">
            Void invoice
          </Button>
        </form>
      </DetailDrawer>
      <CreateInvoiceDrawer
        open={open}
        onOpenChange={setOpen}
        workspaceId={workspaceId}
        name={name}
        plans={plans}
        onDone={refresh}
      />
    </section>
  )
}

function CreateInvoiceDrawer({
  open,
  onOpenChange,
  workspaceId,
  name,
  plans,
  onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  workspaceId: string
  name: string
  plans: Array<{ key: string; name: string }>
  onDone: () => void
}) {
  const [kind, setKind] = useState<'PLAN_RENEWAL' | 'WALLET_TOPUP'>('PLAN_RENEWAL')
  const [planKey, setPlanKey] = useState(plans[0]?.key ?? '')
  const [amount, setAmount] = useState('')
  const [due, setDue] = useState(() =>
    new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
  )
  const [description, setDescription] = useState('')
  const [idempotencyKey, setKey] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    const amountMinor = minorFrom(amount)
    if (!amountMinor) return setError('Enter the amount in rupees, for example 1499 or 1499.50.')
    const parsed = createInvoiceRequestSchema.safeParse({
      kind,
      amountMinor,
      ...(kind === 'PLAN_RENEWAL' ? { planKey } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
      // End of the chosen day in India.
      dueAt: new Date(`${due}T23:59:59+05:30`).toISOString(),
      idempotencyKey,
    })
    if (!parsed.success) return setError(parsed.error.issues.map((i) => i.message).join(' · '))
    setBusy(true)
    try {
      await platformRequest(`/workspaces/${workspaceId}/invoices`, parsed.data)
      toast.success(`Invoice created for ${name}`)
      setAmount('')
      setDescription('')
      setKey(crypto.randomUUID())
      onOpenChange(false)
      onDone()
    } catch (err) {
      setError(failure(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <DetailDrawer
      open={open}
      onOpenChange={(v) => !busy && onOpenChange(v)}
      title="Create invoice"
      description={`For ${name}. The customer pays by UPI and submits the UTR; you verify it in Payments.`}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Type" required>
          <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
            <SelectTrigger aria-label="Type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PLAN_RENEWAL">Plan renewal (1 month)</SelectItem>
              <SelectItem value="WALLET_TOPUP">Wallet top-up</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {kind === 'PLAN_RENEWAL' ? (
          <Field label="Plan" required>
            <Select value={planKey} onValueChange={setPlanKey}>
              <SelectTrigger aria-label="Plan">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {plans.map((p) => (
                  <SelectItem key={p.key} value={p.key}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}
        <Field label="Amount before tax (₹)" hint="GST is added only if configured" required>
          <Input
            required
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Due date" required>
          <Input required type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <Field label="Description (optional)">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {error ? (
          <Alert tone="danger" title="Not created">
            {error}
          </Alert>
        ) : null}
        <Button type="submit" loading={busy}>
          Create invoice
        </Button>
      </form>
    </DetailDrawer>
  )
}

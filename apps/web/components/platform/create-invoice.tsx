'use client'
import {
  commercialReceiptSchema,
  createInvoiceRequestSchema,
  platformPlanSchema,
  platformWorkspaceRowSchema,
} from '@fenwira/contracts'
import {
  Alert,
  Button,
  DetailDrawer,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SummaryItem,
  toast,
} from '@fenwira/ui'
import { useQuery } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { z } from 'zod'
import { formatMoney } from '@/lib/billing'
import { errorText } from '@/lib/api/client'
import { platformRequest } from '@/lib/platform'
import { useIdentityRequest } from './identity'

/** "1499" or "1499.50" rupees → paise; anything else is refused. */
export function minorFrom(value: string): number | null {
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(value.trim())
  if (!m) return null
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
}

/** Customer-facing page where the invoice is paid by UPI (Billing → Invoices). */
export const paymentLink = (invoiceId: string) =>
  `${window.location.origin}/billing/invoices?invoice=${invoiceId}`

export function paymentMessage(p: {
  workspace: string
  number: string
  amountMinor: number | string
  dueAt: string
  link: string
}) {
  return [
    `Hello from Fenwira. Payment request ${p.number} for ${p.workspace} is ready: ${formatMoney(Number(p.amountMinor), 'INR')}, due ${new Date(p.dueAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}.`,
    `Pay by UPI here (sign in to Fenwira first): ${p.link}`,
    'After paying, enter the UTR from your bank on the same page so we can confirm it.',
  ].join('\n')
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${what} copied`)
  } catch {
    toast.error('Copy failed. Select the text and copy it manually.')
  }
}

type Created = {
  invoiceId: string
  number: string
  totalMinor: string
  workspace: string
  dueAt: string
}

/**
 * Create invoice (ADR-0027 manual UPI): pick workspace, plan and amount (plan price or custom), due
 * date → preview → create → payment link and a ready-to-send message.
 */
export function CreateInvoiceFlow({
  open,
  onOpenChange,
  workspace,
  onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** Fixed workspace (workspace page); omitted = the operator picks one. */
  workspace?: { id: string; name: string }
  onDone?: () => void
}) {
  const request = useIdentityRequest()
  const plans = useQuery({
    queryKey: ['platform', 'plans'],
    enabled: open,
    retry: false,
    queryFn: async () => z.array(platformPlanSchema).parse(await platformRequest('/plans')),
  })
  const list = useQuery({
    queryKey: ['platform', 'workspace-list'],
    enabled: open && !workspace,
    retry: false,
    queryFn: async () =>
      z.array(platformWorkspaceRowSchema).parse(await platformRequest('/workspace-list')),
  })
  const [picked, setPicked] = useState('')
  // The fixed workspace can change while the drawer stays mounted (Billing operations rows).
  const workspaceId = workspace?.id ?? picked
  const [planKey, setPlanKey] = useState('')
  const [custom, setCustom] = useState(false)
  const [amount, setAmount] = useState('')
  const [due, setDue] = useState(() =>
    new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
  )
  const [description, setDescription] = useState('')
  const [idempotencyKey, setKey] = useState(() => crypto.randomUUID())
  const [step, setStep] = useState<'form' | 'preview'>('form')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState<Created | null>(null)

  const plan = plans.data?.find((p) => p.key === planKey)
  const targetName =
    workspace?.name ?? list.data?.find((w) => w.id === workspaceId)?.name ?? 'Select a workspace'
  const amountMinor = custom ? minorFrom(amount) : (plan?.monthly?.amountMinor ?? null)
  const dueAt = new Date(`${due}T23:59:59+05:30`).toISOString()

  function reset() {
    setStep('form')
    setError('')
    setCreated(null)
    setAmount('')
    setDescription('')
    setCustom(false)
    setKey(crypto.randomUUID())
    setPicked('')
  }
  function review(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (!workspaceId) return setError('Choose the workspace to invoice.')
    if (!plan) return setError('Choose the plan this invoice is for.')
    if (!amountMinor)
      return setError(
        custom
          ? 'Enter the amount in rupees, for example 1499 or 1499.50.'
          : 'This plan has no price yet. Set it under Plans & prices, or enter a custom amount.',
      )
    if (new Date(dueAt).getTime() < Date.now()) return setError('Choose a due date in the future.')
    setStep('preview')
  }
  async function create() {
    setBusy(true)
    setError('')
    try {
      const body = createInvoiceRequestSchema.parse({
        kind: 'PLAN_RENEWAL',
        planKey,
        amountMinor,
        ...(description.trim() ? { description: description.trim() } : {}),
        dueAt,
        idempotencyKey,
      })
      const receipt = commercialReceiptSchema.parse(
        await request(`/workspaces/${workspaceId}/invoices`, body),
      )
      const result = z
        .object({ invoiceId: z.uuid(), number: z.string(), totalMinor: z.coerce.string() })
        .parse(receipt.result)
      setCreated({ ...result, workspace: targetName, dueAt })
      toast.success(`Invoice ${result.number} created for ${targetName}`)
      onDone?.()
    } catch (err) {
      // The same idempotency key is kept, so retrying never creates a second invoice.
      setError(errorText(err, 'Could not create the invoice. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  const link = created ? paymentLink(created.invoiceId) : ''
  return (
    <DetailDrawer
      open={open}
      onOpenChange={(v) => {
        if (busy) return
        if (!v) reset()
        onOpenChange(v)
      }}
      title={
        created ? 'Invoice created' : step === 'preview' ? 'Check and create' : 'Create invoice'
      }
      description={
        created
          ? 'Send the customer the payment link. They pay by UPI and enter the UTR; you approve it in Payments.'
          : 'A payment request for one month of a plan. The customer pays by UPI and submits the UTR.'
      }
    >
      {created ? (
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-3">
            <SummaryItem label="Invoice">{created.number}</SummaryItem>
            <SummaryItem label="Total">
              {formatMoney(Number(created.totalMinor), 'INR')}
            </SummaryItem>
            <SummaryItem label="Workspace">{created.workspace}</SummaryItem>
            <SummaryItem label="Due">{new Date(created.dueAt).toLocaleDateString()}</SummaryItem>
          </dl>
          <Field
            label="Payment link"
            hint="Opens Billing → Invoices for this invoice after sign-in."
          >
            <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void copy(link, 'Payment link')}>Copy payment link</Button>
            <Button
              variant="secondary"
              onClick={() =>
                void copy(
                  paymentMessage({
                    workspace: created.workspace,
                    number: created.number,
                    amountMinor: created.totalMinor,
                    dueAt: created.dueAt,
                    link,
                  }),
                  'Message',
                )
              }
            >
              Copy message for customer
            </Button>
          </div>
          <Button variant="ghost" onClick={reset}>
            Create another invoice
          </Button>
        </div>
      ) : step === 'preview' ? (
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-3" aria-label="Invoice preview">
            <SummaryItem label="Workspace">{targetName}</SummaryItem>
            <SummaryItem label="Plan">{plan?.name}, 1 month</SummaryItem>
            <SummaryItem label="Amount (before tax)">
              {amountMinor ? formatMoney(amountMinor, 'INR') : '—'}
              {custom ? ' (custom)' : ''}
            </SummaryItem>
            <SummaryItem label="Due">{new Date(dueAt).toLocaleDateString()}</SummaryItem>
          </dl>
          <p className="text-sm text-fg-secondary">
            Tax is added as configured on the server. Nothing is created until you press Create
            invoice. Paying it activates or renews this plan.
          </p>
          {error ? (
            <Alert tone="danger" title="Not created">
              {error}
            </Alert>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button loading={busy} onClick={() => void create()}>
              Create invoice
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setStep('form')}>
              Back
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={review} className="flex flex-col gap-4">
          {workspace ? null : (
            <Field label="Workspace" required>
              <Select value={picked} onValueChange={setPicked}>
                <SelectTrigger aria-label="Workspace">
                  <SelectValue placeholder={list.isPending ? 'Loading…' : 'Select…'} />
                </SelectTrigger>
                <SelectContent>
                  {(list.data ?? [])
                    .filter((w) => !w.internal)
                    .map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label="Plan" required>
            <Select value={planKey} onValueChange={setPlanKey}>
              <SelectTrigger aria-label="Plan">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {(plans.data ?? []).map((p) => (
                  <SelectItem key={p.key} value={p.key}>
                    {p.name}
                    {p.monthly
                      ? ` · ${formatMoney(p.monthly.amountMinor, 'INR')}/month`
                      : ' · no price'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Amount">
            <Select
              value={custom ? 'custom' : 'plan'}
              onValueChange={(v) => setCustom(v === 'custom')}
            >
              <SelectTrigger aria-label="Amount">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="plan">Plan price</SelectItem>
                <SelectItem value="custom">Custom amount</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {custom ? (
            <Field
              label="Custom amount (₹, before tax)"
              required
              hint="For example 1499 or 1499.50"
            >
              <Input
                required
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
          ) : null}
          <Field label="Due date" required>
            <Input type="date" required value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <Field label="Description" hint="Optional. Shown to the customer.">
            <Input
              maxLength={200}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          {error ? (
            <Alert tone="danger" title="Check the form">
              {error}
            </Alert>
          ) : null}
          <Button type="submit">Preview invoice</Button>
        </form>
      )}
    </DetailDrawer>
  )
}

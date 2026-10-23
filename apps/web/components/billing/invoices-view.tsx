'use client'

import {
  type Invoice,
  type InvoiceDetail,
  type InvoiceDisplayStatus,
  PAYMENT_PROOF_MAX_BYTES,
  PAYMENT_PROOF_MIME_TYPES,
  submitPaymentProofRequestSchema,
} from '@fenwira/contracts'
import {
  Alert,
  Button,
  Card,
  DetailDrawer,
  DetailPage,
  EmptyState,
  ErrorState,
  Field,
  Input,
  ModuleTabs,
  PermissionState,
  Skeleton,
  StatusBadge,
  type StatusKey,
  SummaryItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@fenwira/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Download, FileText, Receipt } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { type FormEvent, useState } from 'react'
import { useSession } from '@/components/session/session-provider'
import { ApiError, download, get, post } from '@/lib/api/client'
import { formatMoney } from '@/lib/billing'
import { keys } from '@/lib/api/keys'

const STATUS: Record<InvoiceDisplayStatus, { status: StatusKey; label: string }> = {
  DUE: { status: 'PENDING', label: 'Due' },
  OVERDUE: { status: 'ATTENTION', label: 'Overdue' },
  PAYMENT_SUBMITTED: { status: 'PROCESSING', label: 'Verifying payment' },
  PAID: { status: 'COMPLETED', label: 'Paid' },
  VOID: { status: 'CANCELLED', label: 'Void' },
}
const day = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '—'
const message = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong.')

/**
 * Billing → Invoices (ADR-0027 Managed Launch Mode): payment requests from Fenwira, paid by UPI
 * (QR or deep link), then confirmed by submitting the UTR. Fenwira verifies each payment by hand.
 */
export function InvoicesView() {
  const { tenantId, can } = useSession()
  const params = useSearchParams()
  const router = useRouter()
  const openId = params.get('invoice')
  const list = useQuery({
    queryKey: keys.tenant(tenantId, 'invoices'),
    queryFn: () => get<{ data: Invoice[] }>('/billing/invoices').then((r) => r.data),
    enabled: can('billing.read'),
  })
  const open = (id: string | null) =>
    router.replace(id ? `/billing/invoices?invoice=${id}` : '/billing/invoices', { scroll: false })

  if (!can('billing.read')) return <PermissionState what="invoices" />
  const due = list.data?.filter((i) => i.status === 'OPEN') ?? []
  return (
    <DetailPage
      header={{
        title: 'Billing',
        description: 'Payment requests for your Fenwira subscription and WhatsApp credits.',
      }}
      banner={
        <Alert tone="info" title="Meta charges are billed separately">
          WhatsApp conversation charges from Meta are billed by Meta to the payment method in your
          Meta Business account. Fenwira invoices cover only your Fenwira subscription and wallet
          credits.
        </Alert>
      }
    >
      <ModuleTabs
        label="Billing pages"
        className="bg-transparent"
        linkAs={Link}
        items={[
          {
            id: 'subscription',
            label: 'Subscription',
            href: '/billing/subscription',
            active: false,
          },
          { id: 'invoices', label: 'Invoices', href: '/billing/invoices', active: true },
          { id: 'wallet', label: 'Wallet', href: '/billing/wallet', active: false },
          { id: 'usage', label: 'Usage', href: '/billing/usage', active: false },
        ]}
      />
      {list.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : list.isError ? (
        <ErrorState onRetry={() => void list.refetch()} />
      ) : list.data.length === 0 ? (
        <EmptyState
          icon={<FileText aria-hidden="true" />}
          title="No invoices yet"
          description="Payment requests from Fenwira appear here. Pay them by UPI and submit the reference number."
        />
      ) : (
        <>
          {due.length ? (
            <p className="text-sm text-secondary">
              {due.length} open payment request{due.length === 1 ? '' : 's'}. Pay by UPI, then
              submit the UTR so we can confirm it.
            </p>
          ) : null}
          <Table containerLabel="Invoices">
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>For</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell>
                    <Button variant="link" className="h-auto p-0" onClick={() => open(inv.id)}>
                      {inv.number}
                    </Button>
                  </TableCell>
                  <TableCell>{inv.description}</TableCell>
                  <TableCell>{formatMoney(inv.totalMinor, inv.currency)}</TableCell>
                  <TableCell>{day(inv.dueAt)}</TableCell>
                  <TableCell>
                    <StatusBadge {...STATUS[inv.displayStatus]} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
      <InvoiceDrawer id={openId} onClose={() => open(null)} />
    </DetailPage>
  )
}

function InvoiceDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { tenantId } = useSession()
  const detail = useQuery({
    queryKey: keys.tenant(tenantId, 'invoices', id ?? ''),
    queryFn: () => get<{ data: InvoiceDetail }>(`/billing/invoices/${id}`).then((r) => r.data),
    enabled: Boolean(id),
  })
  const inv = detail.data
  return (
    <DetailDrawer
      open={Boolean(id)}
      onOpenChange={(v) => !v && onClose()}
      title={inv ? `Invoice ${inv.number}` : 'Invoice'}
      description={inv?.description}
    >
      {detail.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : detail.isError ? (
        <ErrorState onRetry={() => void detail.refetch()} />
      ) : inv ? (
        <InvoiceBody inv={inv} />
      ) : null}
    </DetailDrawer>
  )
}

function InvoiceBody({ inv }: { inv: InvoiceDetail }) {
  const { can } = useSession()
  const pending = inv.proofs.find((p) => p.status === 'PENDING')
  const doc = (kind: 'document' | 'receipt') =>
    download(
      `/billing/invoices/${inv.id}/${kind}?download=1`,
      undefined,
      `${kind === 'receipt' ? (inv.receiptNumber ?? 'receipt') : inv.number}.html`,
      'GET',
    ).catch((err: unknown) => toast.error(message(err)))
  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-2 gap-4">
        <SummaryItem label="Status">
          <StatusBadge {...STATUS[inv.displayStatus]} />
        </SummaryItem>
        <SummaryItem label="Due">{day(inv.dueAt)}</SummaryItem>
        <SummaryItem label="Issued">{day(inv.issuedAt)}</SummaryItem>
        {inv.taxLines.length ? (
          <SummaryItem label="Amount (before GST)">
            {formatMoney(inv.subtotalMinor, inv.currency)}
          </SummaryItem>
        ) : null}
        {inv.taxLines.map((t) => (
          <SummaryItem key={t.label} label={t.label}>
            {formatMoney(t.amountMinor, inv.currency)}
          </SummaryItem>
        ))}
        <SummaryItem label={inv.taxLines.length ? 'Total to pay' : 'Amount to pay'}>
          {formatMoney(inv.totalMinor, inv.currency)}
        </SummaryItem>
        {inv.receiptNumber ? <SummaryItem label="Receipt">{inv.receiptNumber}</SummaryItem> : null}
      </dl>

      {inv.upi && !pending ? (
        <Card className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL QR code */}
          <img
            src={inv.upi.qrDataUrl}
            alt={`UPI QR code to pay ${formatMoney(inv.totalMinor, inv.currency)} for ${inv.number}`}
            className="size-44 shrink-0 self-center"
          />
          <div className="flex min-w-0 flex-col gap-2">
            <p className="font-medium text-slate">Scan with any UPI app</p>
            <p className="text-sm text-secondary">
              Or pay {inv.payee.name} at <span className="font-mono">{inv.payee.vpa}</span> with
              reference <span className="font-mono">{inv.number}</span>.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" asChild>
                <a href={inv.upi.deepLink}>Open in UPI app</a>
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(inv.upi!.deepLink)
                    .then(() => toast.success('UPI payment link copied'))
                }
              >
                <Copy aria-hidden="true" />
                Copy UPI link
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {pending ? (
        <Alert tone="info" title="We're verifying your payment">
          UTR {pending.utr}, submitted {day(pending.submittedAt)}. You'll be notified once it's
          confirmed.
        </Alert>
      ) : null}
      {inv.status === 'OPEN' && !pending ? (
        can('billing.manage') ? (
          <ProofForm invoiceId={inv.id} />
        ) : (
          <p className="text-sm text-secondary">
            The workspace owner submits the payment reference after paying.
          </p>
        )
      ) : null}

      {inv.proofs.length ? (
        <section aria-labelledby="proofs-heading" className="flex flex-col gap-2">
          <h3 id="proofs-heading" className="text-md font-semibold">
            Payment submissions
          </h3>
          <ul className="flex flex-col gap-2">
            {inv.proofs.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
                <StatusBadge status={p.status} />
                <span className="font-mono">{p.utr}</span>
                <span className="text-secondary">{day(p.submittedAt)}</span>
                {p.rejectionReason ? (
                  <span className="text-secondary">· {p.rejectionReason}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => void doc('document')}>
          <Download aria-hidden="true" />
          Payment request
        </Button>
        {inv.status === 'PAID' ? (
          <Button variant="secondary" size="sm" onClick={() => void doc('receipt')}>
            <Receipt aria-hidden="true" />
            Receipt
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function ProofForm({ invoiceId }: { invoiceId: string }) {
  const { tenantId } = useSession()
  const queryClient = useQueryClient()
  const [utr, setUtr] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    const parsed = submitPaymentProofRequestSchema.shape.utr.safeParse(utr)
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Check the UTR.')
    if (file && !(PAYMENT_PROOF_MIME_TYPES as readonly string[]).includes(file.type))
      return setError('Attach a PNG, JPEG or PDF.')
    if (file && file.size > PAYMENT_PROOF_MAX_BYTES)
      return setError('The screenshot must be 5 MB or smaller.')
    setBusy(true)
    try {
      let fileId: string | undefined
      if (file) {
        const up = await post<{
          data: { fileId: string; url: string; headers: Record<string, string> }
        }>(`/billing/invoices/${invoiceId}/proof-uploads`, {
          filename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        })
        const put = await fetch(up.data.url, {
          method: 'PUT',
          headers: up.data.headers,
          body: file,
        })
        if (!put.ok) throw new Error('upload')
        fileId = up.data.fileId
      }
      await post(`/billing/invoices/${invoiceId}/proofs`, {
        utr: parsed.data,
        ...(fileId ? { fileId } : {}),
      })
      toast.success('Payment submitted. We will confirm it shortly.')
      setUtr('')
      setFile(null)
      void queryClient.invalidateQueries({ queryKey: keys.tenant(tenantId, 'invoices') })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The screenshot could not be uploaded.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-3" aria-labelledby="proof-heading">
      <h3 id="proof-heading" className="text-md font-semibold">
        Already paid? Confirm your payment
      </h3>
      <Field label="UTR / UPI reference number" hint="12 digits in most UPI apps" required>
        <Input
          required
          autoComplete="off"
          value={utr}
          onChange={(e) => setUtr(e.target.value)}
          aria-invalid={Boolean(error)}
        />
      </Field>
      <Field label="Screenshot (optional)" hint="PNG, JPEG or PDF, up to 5 MB">
        <Input
          type="file"
          accept={PAYMENT_PROOF_MIME_TYPES.join(',')}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </Field>
      {error ? (
        <p role="alert" className="text-sm text-danger-strong">
          {error}
        </p>
      ) : null}
      <Button type="submit" loading={busy} className="self-start">
        Submit payment
      </Button>
    </form>
  )
}

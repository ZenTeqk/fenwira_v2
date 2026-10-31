'use client'
import {
  platformInvoiceSchema,
  type PlatformInvoice,
  voidInvoiceRequestSchema,
} from '@fenwira/contracts'
import {
  Button,
  DetailDrawer,
  EmptyState,
  ErrorState,
  Field,
  Input,
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
import { errorText } from '@/lib/api/client'
import { platformMoney, platformRequest } from '@/lib/platform'
import { useIdentityRequest } from './identity'
import { CreateInvoiceFlow } from './create-invoice'
import { usePlatform } from './platform-shell'

const STATUS: Record<PlatformInvoice['displayStatus'], { status: StatusKey; label: string }> = {
  DUE: { status: 'PENDING', label: 'Due' },
  OVERDUE: { status: 'ATTENTION', label: 'Overdue' },
  PAYMENT_SUBMITTED: { status: 'PROCESSING', label: 'Proof submitted' },
  PAID: { status: 'COMPLETED', label: 'Paid' },
  VOID: { status: 'CANCELLED', label: 'Void' },
}
const failure = (err: unknown) => errorText(err, 'The request failed. Try again.')

/** ADR-0027 manual UPI billing: a workspace's payment requests, issued and voided by an operator. */
export function WorkspaceInvoices({ workspaceId, name }: { workspaceId: string; name: string }) {
  const request = useIdentityRequest()
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
      await request(`/workspaces/${workspaceId}/invoices/${inv.id}/void`, parsed.data)
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
              <TableHead className="text-right">Total</TableHead>
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
                    <span className="block text-sm text-fg-secondary">{inv.receiptNumber}</span>
                  ) : null}
                </TableCell>
                <TableCell>{inv.description}</TableCell>
                <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                  {platformMoney(inv.totalMinor, inv.currency)}
                </TableCell>
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
      <CreateInvoiceFlow
        open={open}
        onOpenChange={setOpen}
        workspace={{ id: workspaceId, name }}
        onDone={refresh}
      />
    </section>
  )
}

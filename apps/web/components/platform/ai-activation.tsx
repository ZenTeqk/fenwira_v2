'use client'
import {
  type AiActivationStatus,
  aiActivationDecisionResultSchema,
  aiPlanSchema,
  type AiPlan,
  platformAiActivationRequestSchema,
  type PlatformAiActivationRequest,
} from '@fenwira/contracts'
import {
  Alert,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  ListPage,
  Modal,
  ModalContent,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusBadge,
  Switch,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  toast,
} from '@fenwira/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { type FormEvent, useState } from 'react'
import { z } from 'zod'
import { errorText } from '@/lib/api/client'
import { formatMoney } from '@/lib/billing'
import { platformRequest } from '@/lib/platform'
import { requestsKey } from './ai-requests-nav'
import { useIdentityRequest } from './identity'
import { usePlatform } from './platform-shell'

const failure = (err: unknown) => errorText(err, 'The request failed. Try again.')

const BADGE: Record<
  AiActivationStatus,
  { status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'; label: string }
> = {
  REQUESTED: { status: 'PENDING', label: 'Requested' },
  APPROVED: { status: 'APPROVED', label: 'Approved' },
  REJECTED: { status: 'REJECTED', label: 'Rejected' },
  CANCELLED: { status: 'CANCELLED', label: 'Cancelled' },
}

/** /platform/ai-requests: review AI Assistant activation requests. */
export function AiRequestsView() {
  const me = usePlatform()
  const canDecide = !!me?.permissions.includes('workspaces.manage')
  const [status, setStatus] = useState<AiActivationStatus | 'ALL'>('REQUESTED')
  const [deciding, setDeciding] = useState<{
    request: PlatformAiActivationRequest
    approve: boolean
  } | null>(null)
  const rows = useQuery({
    queryKey: requestsKey(status),
    retry: false,
    queryFn: async () =>
      z
        .array(platformAiActivationRequestSchema)
        .parse(await platformRequest(`/ai/requests${status === 'ALL' ? '' : `?status=${status}`}`)),
  })
  return (
    <ListPage
      header={{
        title: 'AI requests',
        description:
          'Workspaces asking for AI Assistant. Approving turns it on with the plan’s monthly replies; both outcomes notify the workspace and are audited.',
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Status">
          <Select value={status} onValueChange={(v) => setStatus(v as AiActivationStatus | 'ALL')}>
            <SelectTrigger aria-label="Status" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="REQUESTED">Requested</SelectItem>
              <SelectItem value="APPROVED">Approved</SelectItem>
              <SelectItem value="REJECTED">Rejected</SelectItem>
              <SelectItem value="CANCELLED">Cancelled</SelectItem>
              <SelectItem value="ALL">All</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      {rows.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : rows.isError ? (
        <ErrorState onRetry={() => void rows.refetch()} />
      ) : rows.data.length === 0 ? (
        <EmptyState
          title="No AI requests"
          description="New requests appear here and are emailed to the operations address."
        />
      ) : (
        <Table containerLabel="AI activation requests">
          <TableHeader>
            <TableRow>
              <TableHead>Workspace</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Conversations / month</TableHead>
              <TableHead>Use case</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.data.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link
                    className="font-medium text-primary-strong underline-offset-4 hover:underline"
                    href={`/platform/workspaces/${r.workspaceId}`}
                  >
                    {r.workspaceName}
                  </Link>
                  <p className="text-xs text-secondary">
                    {new Date(r.createdAt).toLocaleString('en-IN')}
                  </p>
                </TableCell>
                <TableCell>
                  {r.planName ?? 'Pricing requested'}
                  {r.includedReplies !== null ? (
                    <p className="text-xs text-secondary">
                      {r.includedReplies.toLocaleString('en-IN')} replies
                    </p>
                  ) : null}
                </TableCell>
                <TableCell>{r.expectedConversations.toLocaleString('en-IN')}</TableCell>
                <TableCell className="max-w-xs whitespace-normal">{r.useCase}</TableCell>
                <TableCell>
                  {r.contactEmail}
                  {r.contactPhone ? (
                    <p className="text-xs text-secondary">{r.contactPhone}</p>
                  ) : null}
                </TableCell>
                <TableCell>
                  <StatusBadge status={BADGE[r.status].status} label={BADGE[r.status].label} />
                  {r.decisionNote ? (
                    <p className="mt-1 text-xs text-secondary">{r.decisionNote}</p>
                  ) : null}
                </TableCell>
                <TableCell>
                  {canDecide && r.status === 'REQUESTED' ? (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => setDeciding({ request: r, approve: true })}>
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setDeciding({ request: r, approve: false })}
                      >
                        Reject
                      </Button>
                    </div>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {deciding ? (
        <DecisionDialog
          request={deciding.request}
          approve={deciding.approve}
          onClose={() => setDeciding(null)}
        />
      ) : null}
    </ListPage>
  )
}

function DecisionDialog({
  request: r,
  approve,
  onClose,
}: {
  request: PlatformAiActivationRequest
  approve: boolean
  onClose: () => void
}) {
  const request = useIdentityRequest()
  const qc = useQueryClient()
  const [note, setNote] = useState('')
  const [quota, setQuota] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const needsQuota = approve && r.includedReplies === null
  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!approve && note.trim().length < 3)
      return setError('Tell the workspace why (at least 3 characters).')
    if (needsQuota && !/^\d+$/.test(quota))
      return setError('Set the monthly AI replies for this workspace.')
    setBusy(true)
    try {
      const result = aiActivationDecisionResultSchema.parse(
        await request(
          `/ai/workspaces/${r.workspaceId}/requests/${r.id}/${approve ? 'approve' : 'reject'}`,
          {
            note: note.trim() || undefined,
            ...(needsQuota ? { monthlyMessageQuota: Number(quota) } : {}),
          },
        ),
      )
      toast.success(
        result.alreadyEnabled
          ? `${r.workspaceName} already had AI Assistant on. The request is closed; nothing else changed.`
          : approve
            ? `AI Assistant turned on for ${r.workspaceName}`
            : `Request from ${r.workspaceName} rejected`,
      )
      await qc.invalidateQueries({ queryKey: ['platform', 'ai-requests'] })
      onClose()
    } catch (err) {
      setError(failure(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent
        title={approve ? `Approve ${r.workspaceName}?` : `Reject ${r.workspaceName}?`}
        description={
          approve
            ? r.includedReplies !== null
              ? `Turns AI Assistant on with ${r.includedReplies.toLocaleString('en-IN')} AI replies per month (${r.planName}).`
              : 'This request has no plan. Set the monthly AI replies to turn it on.'
            : 'The workspace sees your note on the AI Assistant page and in the email.'
        }
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="ai-decision"
              loading={busy}
              variant={approve ? 'primary' : 'danger'}
            >
              {approve ? 'Approve and turn on' : 'Reject request'}
            </Button>
          </>
        }
      >
        <form
          id="ai-decision"
          className="flex flex-col gap-4"
          onSubmit={(e) => void submit(e)}
          noValidate
        >
          {error ? (
            <Alert tone="danger" title="Not saved">
              {error}
            </Alert>
          ) : null}
          {needsQuota ? (
            <Field label="Monthly AI replies" required>
              <Input inputMode="numeric" value={quota} onChange={(e) => setQuota(e.target.value)} />
            </Field>
          ) : null}
          <Field
            label={approve ? 'Note (optional)' : 'Reason'}
            required={!approve}
            hint="Shown to the workspace."
          >
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </form>
      </ModalContent>
    </Modal>
  )
}

const plansKey = ['platform', 'ai-plans']

/** /platform/ai-plans: the plans customers see on the AI Assistant page. */
export function AiPlansView() {
  const me = usePlatform()
  const canEdit = !!me?.permissions.includes('workspaces.manage')
  const [editing, setEditing] = useState<AiPlan | 'new' | null>(null)
  const plans = useQuery({
    queryKey: plansKey,
    retry: false,
    queryFn: async () => z.array(aiPlanSchema).parse(await platformRequest('/ai/plans')),
  })
  return (
    <ListPage
      header={{
        title: 'AI plans',
        description:
          'Plans shown on the AI Assistant page. Only active plans are visible to customers; with none active, customers see “Contact us for pricing”.',
        actions: canEdit ? (
          <Button onClick={() => setEditing('new')}>New AI plan</Button>
        ) : undefined,
      }}
    >
      {plans.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : plans.isError ? (
        <ErrorState onRetry={() => void plans.refetch()} />
      ) : plans.data.length === 0 ? (
        <EmptyState title="No AI plans" />
      ) : (
        <Table containerLabel="AI plans">
          <TableHeader>
            <TableRow>
              <TableHead>Plan</TableHead>
              <TableHead>Monthly price</TableHead>
              <TableHead>AI replies / month</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plans.data.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  {p.name}
                  {p.description ? <p className="text-xs text-secondary">{p.description}</p> : null}
                </TableCell>
                <TableCell>{formatMoney(p.monthlyPriceMinor, p.currency)}</TableCell>
                <TableCell>{p.includedReplies.toLocaleString('en-IN')}</TableCell>
                <TableCell>
                  <StatusBadge
                    status={p.active ? 'ACTIVE' : 'INACTIVE'}
                    label={p.active ? 'Active' : 'Inactive'}
                  />
                </TableCell>
                <TableCell>
                  {canEdit ? (
                    <Button size="sm" variant="secondary" onClick={() => setEditing(p)}>
                      Edit<span className="sr-only"> {p.name}</span>
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {editing ? (
        <PlanDialog plan={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      ) : null}
    </ListPage>
  )
}

function PlanDialog({ plan, onClose }: { plan: AiPlan | null; onClose: () => void }) {
  const request = useIdentityRequest()
  const qc = useQueryClient()
  const [name, setName] = useState(plan?.name ?? '')
  const [rupees, setRupees] = useState(plan ? String(plan.monthlyPriceMinor / 100) : '')
  const [replies, setReplies] = useState(plan ? String(plan.includedReplies) : '')
  const [description, setDescription] = useState(plan?.description ?? '')
  const [sortOrder, setSortOrder] = useState(String(plan?.sortOrder ?? 0))
  const [active, setActive] = useState(plan?.active ?? false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    const monthlyPriceMinor = Math.round(Number(rupees) * 100)
    if (name.trim().length < 2) return setError('Enter a plan name.')
    if (rupees === '' || !Number.isFinite(monthlyPriceMinor) || monthlyPriceMinor < 0)
      return setError('Enter the monthly price in rupees.')
    if (!/^\d+$/.test(replies)) return setError('Enter the AI replies per month.')
    setBusy(true)
    try {
      await request(plan ? `/ai/plans/${plan.id}` : '/ai/plans', {
        name: name.trim(),
        monthlyPriceMinor,
        currency: 'INR',
        includedReplies: Number(replies),
        description: description.trim() || null,
        active,
        sortOrder: Number(sortOrder) || 0,
      })
      toast.success(plan ? `${name.trim()} saved` : `${name.trim()} created`)
      await qc.invalidateQueries({ queryKey: plansKey })
      onClose()
    } catch (err) {
      setError(failure(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent
        title={plan ? `Edit ${plan.name}` : 'New AI plan'}
        description="Prices are in INR. Deactivate a plan to hide it from customers; plans are never deleted."
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form="ai-plan" loading={busy}>
              Save plan
            </Button>
          </>
        }
      >
        <form
          id="ai-plan"
          className="flex flex-col gap-4"
          onSubmit={(e) => void submit(e)}
          noValidate
        >
          {error ? (
            <Alert tone="danger" title="Not saved">
              {error}
            </Alert>
          ) : null}
          <Field label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Monthly price (₹)" required>
              <Input
                inputMode="decimal"
                value={rupees}
                onChange={(e) => setRupees(e.target.value)}
              />
            </Field>
            <Field label="AI replies per month" required>
              <Input
                inputMode="numeric"
                value={replies}
                onChange={(e) => setReplies(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Description">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label="Display order" hint="Lower numbers are shown first.">
            <Input
              inputMode="numeric"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
            />
          </Field>
          <div className="flex items-center gap-3">
            <Switch id="ai-plan-active" checked={active} onCheckedChange={setActive} />
            <Label htmlFor="ai-plan-active">Active (visible to customers)</Label>
          </div>
        </form>
      </ModalContent>
    </Modal>
  )
}

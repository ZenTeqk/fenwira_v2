'use client'
import {
  CAPABILITY_KEYS,
  ENTITLEMENT_KEYS,
  ENTITLEMENT_LABELS,
  commercialPreviewSchema,
  commercialReceiptSchema,
  entitlementOperationSchema,
  subscriptionOperationSchema,
  walletOperationSchema,
  type CommercialPreview,
  type CommercialReceipt,
  type PlatformWorkspace,
  type PlatformPermission,
} from '@fenwira/contracts'
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailDrawer,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useConfirm,
} from '@fenwira/ui'
import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { ApiError } from '@/lib/api/client'
import { platformMoney } from '@/lib/platform'
import { useIdentityRequest } from './identity'
import { usePlatform } from './platform-shell'
const actions = [
  ['paid_credit', 'Paid credit', 'wallet.manage'],
  ['promotional_credit', 'Promotional credit', 'wallet.manage'],
  ['adjustment', 'Correction', 'wallet.manage'],
  ['refund', 'Usage refund', 'wallet.manage'],
  ['activate', 'Activate / change plan', 'subscription.manage'],
  ['cancel', 'Cancel at period end', 'subscription.manage'],
  ['billing_mode', 'Change billing mode', 'subscription.manage'],
  ['override_set', 'Set entitlement override', 'entitlements.manage'],
  ['override_remove', 'Remove entitlement override', 'entitlements.manage'],
] as const
function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  return (
    <Field label={label} required>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label}>
          <SelectValue placeholder="Select…" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}
function exactMinor(value: string): number {
  if (!/^-?\d+(\.\d{1,2})?$/.test(value))
    throw new Error('Enter an amount with at most two decimal places.')
  const [whole, fraction = ''] = value.replace('-', '').split('.')
  const amount =
    (BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'))) * (value.startsWith('-') ? -1n : 1n)
  if (amount > BigInt(Number.MAX_SAFE_INTEGER) || amount < BigInt(Number.MIN_SAFE_INTEGER))
    throw new Error('Amount outside supported range.')
  return Number(amount)
}
export function ReceiptDetails({ receipt }: { receipt: CommercialReceipt }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 rounded-md border border-border-subtle bg-surface-muted p-4">
        <span className="font-mono text-sm text-fg-secondary">{receipt.operation}</span>
        <span className="text-2xl font-semibold break-all text-fg tabular-nums">
          {receipt.amountMinor === null
            ? 'No amount'
            : platformMoney(receipt.amountMinor, receipt.currency ?? 'INR')}
        </span>
      </div>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-3">
        {[
          ['Reason', receipt.reason],
          ['Reference', receipt.reference],
          ['Workspace', receipt.tenantId],
          ['Operator', receipt.operatorId],
          ['Receipt', receipt.id],
          ['Idempotency key', receipt.idempotencyKey],
          ['Correlation', receipt.correlationId ?? '—'],
          ['Recorded', new Date(receipt.createdAt).toLocaleString()],
        ].map(([label, value], i) => (
          <div key={label} className="contents">
            <dt className="text-sm text-fg-secondary">{label}</dt>
            <dd
              className={
                i < 2
                  ? 'min-w-0 sm:col-span-2 text-sm break-words text-fg'
                  : 'min-w-0 sm:col-span-2 font-mono text-sm break-all text-fg'
              }
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <details>
        <summary className="cursor-pointer rounded-sm font-medium text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">
          Before and after commercial state
        </summary>
        <div className="mt-3 grid gap-3">
          <pre
            className="overflow-auto rounded-md border border-border-subtle bg-surface-muted p-3 text-xs text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            tabIndex={0}
            aria-label="Before state"
          >
            {JSON.stringify(receipt.before, null, 2)}
          </pre>
          <pre
            className="overflow-auto rounded-md border border-border-subtle bg-surface-muted p-3 text-xs text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            tabIndex={0}
            aria-label="After state"
          >
            {JSON.stringify(receipt.after, null, 2)}
          </pre>
        </div>
      </details>
    </div>
  )
}
export function CommercialActions({ data }: { data: PlatformWorkspace }) {
  const request = useIdentityRequest()
  const me = usePlatform(),
    cache = useQueryClient(),
    confirm = useConfirm()
  const allowed = actions.filter((a) => me?.permissions.includes(a[2] as PlatformPermission))
  const [open, setOpen] = useState(false),
    [kind, setKind] = useState<string>(allowed[0]?.[0] ?? 'paid_credit')
  const [amount, setAmount] = useState(''),
    [reason, setReason] = useState(''),
    [reference, setReference] = useState(''),
    [expiry, setExpiry] = useState(''),
    [debit, setDebit] = useState(''),
    [plan, setPlan] = useState(data.plans[0]?.id ?? ''),
    [mode, setMode] = useState('PREPAID'),
    [key, setKey] = useState<string>('max_contacts'),
    [value, setValue] = useState('')
  const [idempotencyKey, setIdempotency] = useState(''),
    [preview, setPreview] = useState<CommercialPreview | null>(null),
    [command, setCommand] = useState<unknown>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [receipt, setReceipt] = useState<CommercialReceipt | null>(null)
  const isWallet = ['paid_credit', 'promotional_credit', 'adjustment', 'refund'].includes(kind),
    isOverride = kind.startsWith('override_')
  const endpoint = isWallet ? 'wallet' : isOverride ? 'entitlement' : 'subscription'
  function edit(setter: (v: string) => void, v: string) {
    setter(v)
    setPreview(null)
    setCommand(null)
    setIdempotency(crypto.randomUUID())
    setError('')
  }
  async function review(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const base = { kind, reason, reference, idempotencyKey, expectedVersion: data.version }
      const expiresAt = expiry ? new Date(expiry).toISOString() : undefined
      const input = isWallet
        ? walletOperationSchema.parse({
            ...base,
            amountMinor: exactMinor(amount),
            currency: 'INR',
            ...(kind === 'refund' ? { debitId: debit } : {}),
            ...(kind === 'promotional_credit' && expiresAt ? { expiresAt } : {}),
          })
        : isOverride
          ? entitlementOperationSchema.parse({
              ...base,
              key,
              ...(kind === 'override_set'
                ? {
                    value:
                      value === 'null'
                        ? null
                        : value === 'true'
                          ? true
                          : value === 'false'
                            ? false
                            : value.trim()
                              ? Number(value)
                              : undefined,
                    ...(expiresAt ? { expiresAt } : {}),
                  }
                : {}),
            })
          : subscriptionOperationSchema.parse({
              ...base,
              ...(kind === 'activate' ? { planId: plan } : kind === 'billing_mode' ? { mode } : {}),
            })
      const reviewed = commercialPreviewSchema.parse(
        await request(`/workspaces/${data.snapshot.workspace.id}/${endpoint}-preview`, input),
      )
      setPreview(reviewed)
      setCommand(input)
    } catch (e) {
      setError(
        e instanceof ApiError
          ? `${e.message}${e.correlationId ? ` Reference: ${e.correlationId}` : ''}`
          : 'Check the amount, required reason/reference and typed values.',
      )
    } finally {
      setBusy(false)
    }
  }
  async function apply() {
    if (!preview || !command || busy) return
    const impact = isWallet
      ? [
          `Ledger entry: ${platformMoney(String(exactMinor(amount)))}.`,
          `Available funds: ${platformMoney(preview.before.wallet?.availableMinor ?? '0')} → ${platformMoney(preview.after.wallet?.availableMinor ?? '0')}.`,
          kind === 'refund'
            ? 'Refund is capped at the original usage debit; no cash payment is made.'
            : kind === 'promotional_credit'
              ? 'Promotional identity and optional expiry metadata are preserved; no consumption policy is introduced.'
              : 'The append-only entry cannot be edited or deleted.',
        ]
      : isOverride
        ? [
            'The selected override has highest precedence while active.',
            'Effective configured entitlements are shown in the preview. Rollout enforcement remains unchanged.',
          ]
        : kind === 'cancel'
          ? ['The subscription ends at its current period end. Customer data is retained.']
          : kind === 'activate'
            ? [
                'Plan activation/change takes effect immediately. Over-limit data is retained.',
                'Wallet funding and subscription activation remain separate.',
              ]
            : [
                'Billing mode changes independently from the subscription. No postpaid policy or gateway is activated.',
              ]
    if (
      !(await confirm({
        title: `Confirm ${actions.find((a) => a[0] === kind)?.[1].toLowerCase()}`,
        description: `Workspace: ${data.snapshot.workspace.name}. Reason: ${reason}. Reference: ${reference}.`,
        impact,
        confirmLabel: 'Record commercial operation',
        destructive:
          (kind === 'adjustment' && amount.startsWith('-')) ||
          kind === 'cancel' ||
          kind === 'override_remove',
      }))
    )
      return
    setBusy(true)
    setError('')
    try {
      const result = commercialReceiptSchema.parse(
        await request(`/workspaces/${data.snapshot.workspace.id}/${endpoint}-operations`, command),
      )
      setReceipt(result)
      setOpen(false)
      setPreview(null)
      setCommand(null)
      await cache.invalidateQueries({
        queryKey: ['platform', 'workspace', data.snapshot.workspace.id],
      })
      await cache.invalidateQueries({
        queryKey: ['platform', 'financial', data.snapshot.workspace.id],
      })
    } catch (e) {
      setError(
        `${e instanceof ApiError ? e.message : 'Result uncertain: inspect audit before starting a new operation.'} Retry uses the same idempotency key: ${idempotencyKey}.`,
      )
    } finally {
      setBusy(false)
    }
  }
  if (!allowed.length) return null
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle as="h2">Billing adjustments (rare)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-fg-secondary">
            For manual corrections to this workspace&apos;s plan, trial, billing mode, credit or
            limits. Each adjustment is recorded permanently and cannot be edited.{' '}
            <strong className="font-medium text-fg">
              Not needed for connecting WhatsApp or approving payments.
            </strong>
          </p>
          <p className="mb-3 text-sm text-fg-secondary">
            You need a reason, a reference (for example a support ticket), a preview and a
            confirmation; identity is checked when you confirm. Afterwards you get a receipt and the
            change appears in the audit log.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => {
                setIdempotency(crypto.randomUUID())
                setPreview(null)
                setCommand(null)
                setError('')
                setOpen(true)
              }}
            >
              Start billing adjustment
            </Button>
          </div>
        </CardContent>
      </Card>
      <DetailDrawer
        open={open}
        onOpenChange={(v) => {
          if (!busy) setOpen(v)
        }}
        title="Commercial operation"
        description={`For ${data.snapshot.workspace.name}. No customer content is available.`}
      >
        <form onSubmit={review} className="flex flex-col gap-4">
          <div className="rounded-md border border-border-subtle bg-surface-muted px-4 py-3 text-sm">
            <span className="text-fg-secondary">Target workspace</span>
            <p className="font-medium break-words text-fg">{data.snapshot.workspace.name}</p>
            <p className="font-mono text-xs break-all text-fg-secondary">
              {data.snapshot.workspace.slug} · {data.snapshot.workspace.id}
            </p>
          </div>
          <Choice
            label="Operation"
            value={kind}
            onChange={(v) => edit(setKind, v)}
            options={allowed.map((a) => ({ value: a[0], label: a[1] }))}
          />
          {isWallet ? (
            <Field
              label="Amount (INR)"
              required
              hint={
                kind === 'adjustment'
                  ? 'Signed correction. Negative available funds after reservations are rejected.'
                  : 'Positive amount; at most two decimal places.'
              }
            >
              <Input
                required
                inputMode="decimal"
                value={amount}
                onChange={(e) => edit(setAmount, e.target.value)}
              />
            </Field>
          ) : null}
          {kind === 'refund' ? (
            <Field
              label="Original usage debit ID"
              required
              hint="Use an immutable message debit from this workspace's ledger. Older debit references are accepted; cumulative refunds cannot exceed that debit."
            >
              <Input required value={debit} onChange={(e) => edit(setDebit, e.target.value)} />
            </Field>
          ) : null}
          {kind === 'activate' ? (
            <Choice
              label="Configured plan"
              value={plan}
              onChange={(v) => edit(setPlan, v)}
              options={data.plans.map((p) => ({ value: p.id, label: p.name }))}
            />
          ) : null}
          {kind === 'billing_mode' ? (
            <Choice
              label="Billing mode"
              value={mode}
              onChange={(v) => edit(setMode, v)}
              options={['FREE', 'TRIAL', 'PREPAID'].map((v) => ({ value: v, label: v }))}
            />
          ) : null}
          {isOverride ? (
            <Choice
              label="Entitlement"
              value={key}
              onChange={(v) => edit(setKey, v)}
              options={ENTITLEMENT_KEYS.map((k) => ({ value: k, label: ENTITLEMENT_LABELS[k] }))}
            />
          ) : null}
          {kind === 'override_set' ? (
            (CAPABILITY_KEYS as readonly string[]).includes(key) ? (
              <Choice
                label="Override value"
                value={value}
                onChange={(v) => edit(setValue, v)}
                options={[
                  { value: 'true', label: 'Enabled' },
                  { value: 'false', label: 'Disabled' },
                ]}
              />
            ) : (
              <Field
                label="Override value"
                required
                hint="Nonnegative integer, or null for unlimited."
              >
                <Input required value={value} onChange={(e) => edit(setValue, e.target.value)} />
              </Field>
            )
          ) : null}
          {['promotional_credit', 'override_set'].includes(kind) ? (
            <Field
              label="Optional expiry"
              hint="Local date/time; promotional expiry is metadata only."
            >
              <Input
                type="datetime-local"
                value={expiry}
                onChange={(e) => edit(setExpiry, e.target.value)}
              />
            </Field>
          ) : null}
          <Field
            label="Reason"
            required
            hint="Commercial context only. Do not include credentials or customer message content."
          >
            <Input
              required
              minLength={5}
              maxLength={500}
              value={reason}
              onChange={(e) => edit(setReason, e.target.value)}
            />
          </Field>
          <Field label="Support / funding reference" required>
            <Input
              required
              maxLength={120}
              value={reference}
              onChange={(e) => edit(setReference, e.target.value)}
            />
          </Field>
          {error ? (
            <Alert tone="danger" title="Operation needs attention">
              {error}
            </Alert>
          ) : null}
          <Button type="submit" variant="secondary" disabled={busy}>
            {busy ? 'Checking…' : 'Preview impact'}
          </Button>
        </form>
        {preview ? (
          <section className="mt-5 flex flex-col gap-3" aria-label="Commercial impact preview">
            <h3 className="font-semibold text-fg">Reviewed impact</h3>
            <p className="text-sm text-fg-secondary">
              No change has been recorded. Workspace state is checked again on confirmation.
            </p>
            {isWallet ? (
              <dl className="grid grid-cols-1 gap-3 rounded-md border border-border-subtle p-4 sm:grid-cols-2">
                <div>
                  <dt className="text-sm text-fg-secondary">Available funds now</dt>
                  <dd className="text-lg font-semibold break-all text-fg tabular-nums">
                    {platformMoney(preview.before.wallet?.availableMinor ?? '0')}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-fg-secondary">After this operation</dt>
                  <dd className="text-lg font-semibold break-all text-fg tabular-nums">
                    {platformMoney(preview.after.wallet?.availableMinor ?? '0')}
                  </dd>
                </div>
              </dl>
            ) : (
              <dl className="grid gap-2">
                {preview.entitlements.map((e) => (
                  <div key={e.key}>
                    <dt className="text-sm text-fg-secondary">
                      {ENTITLEMENT_LABELS[e.key as keyof typeof ENTITLEMENT_LABELS] ?? e.key}
                    </dt>
                    <dd>{e.configured === null ? 'Unlimited' : String(e.configured)}</dd>
                  </div>
                ))}
              </dl>
            )}
            <Button disabled={busy} onClick={() => void apply()}>
              Review and confirm
            </Button>
          </section>
        ) : null}
      </DetailDrawer>
      <DetailDrawer
        open={!!receipt}
        onOpenChange={(v) => {
          if (!v) setReceipt(null)
        }}
        title="Commercial operation recorded"
        description="Immutable receipt; financial change and audit committed together."
      >
        {receipt ? <ReceiptDetails receipt={receipt} /> : null}
      </DetailDrawer>
    </>
  )
}

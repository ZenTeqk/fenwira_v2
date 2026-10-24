import {
  type Invoice,
  type InvoiceDetail,
  type InvoiceDisplayStatus,
  type TaxLine,
} from '@fenwira/contracts'
import { type Prisma, type TenantTx } from '@fenwira/database'
import QRCode from 'qrcode'
import { AppError } from '../../core/http/app-error'
import { type ManualBilling } from './billing.options'
import { BILLING_READER_ROLES, activatePlan } from './subscriptions.core'
import { type BillingPlatform, isInternalWorkspace, postTransaction } from './wallet.core'

/**
 * ADR-0027 Managed Launch Mode step 3 — manual UPI billing (docs/BILLING.md → Manual invoices).
 * Payment requests are issued by an operator (or by the system for a priced plan renewal), paid
 * by UPI, proven by the customer with a UTR, and verified by an operator. Approval is the only
 * path that marks an invoice PAID, and it applies the effect (subscription or wallet) in the same
 * transaction as the receipt.
 */

const DAY = 86_400_000
const addMonth = (d: Date) => {
  const n = new Date(d)
  n.setUTCMonth(n.getUTCMonth() + 1)
  return n
}

type InvoiceRow = Prisma.InvoiceGetPayload<{
  include: { plan: { select: { key: true; name: true } }; proofs: true }
}>
export const INVOICE_INCLUDE = {
  plan: { select: { key: true, name: true } },
  proofs: { orderBy: { submittedAt: 'desc' } },
} as const satisfies Prisma.InvoiceInclude

export function displayStatusOf(inv: InvoiceRow, now = new Date()): InvoiceDisplayStatus {
  if (inv.status === 'PAID') return 'PAID'
  if (inv.status === 'VOID') return 'VOID'
  if (inv.proofs.some((p) => p.status === 'PENDING')) return 'PAYMENT_SUBMITTED'
  return inv.dueAt <= now ? 'OVERDUE' : 'DUE'
}

const minorToNumber = (v: bigint) => Number(v)

export function toInvoice(inv: InvoiceRow, now = new Date()): Invoice {
  const receipt = inv.proofs.find((p) => p.status === 'APPROVED')
  return {
    id: inv.id,
    number: inv.number,
    kind: inv.kind,
    status: inv.status,
    displayStatus: displayStatusOf(inv, now),
    currency: inv.currency,
    subtotalMinor: minorToNumber(inv.subtotalMinor),
    taxMinor: minorToNumber(inv.taxMinor),
    totalMinor: minorToNumber(inv.totalMinor),
    taxLines: inv.taxLines as TaxLine[],
    description: inv.description,
    plan: inv.plan ? { key: inv.plan.key, name: inv.plan.name } : null,
    dueAt: inv.dueAt.toISOString(),
    issuedAt: inv.issuedAt.toISOString(),
    paidAt: inv.paidAt?.toISOString() ?? null,
    voidReason: inv.voidReason,
    payee: { vpa: inv.payeeVpa, name: inv.payeeName },
    gstin: inv.gstin,
    receiptNumber: receipt?.receiptNumber ?? null,
    proofs: inv.proofs.map((p) => ({
      id: p.id,
      utr: p.utr,
      status: p.status,
      hasFile: Boolean(p.fileId),
      submittedAt: p.submittedAt.toISOString(),
      reviewedAt: p.reviewedAt?.toISOString() ?? null,
      rejectionReason: p.rejectionReason,
      receiptNumber: p.receiptNumber,
    })),
  }
}

/** "1234.50": UPI `am` is in major units with up to two decimals. */
export const majorAmount = (minor: bigint) =>
  `${minor / 100n}.${(minor % 100n).toString().padStart(2, '0')}`

/**
 * `upi://pay?pa=<VPA>&pn=<name>&am=<amount>&cu=INR&tn=<invoice number>` (NPCI UPI linking spec).
 * Values are percent-encoded (spaces as %20, which every UPI app accepts; `+` is not).
 */
export function upiDeepLink(inv: {
  payeeVpa: string
  payeeName: string
  totalMinor: bigint
  currency: string
  number: string
}): string {
  const q = (k: string, v: string) => `${k}=${encodeURIComponent(v)}`
  return `upi://pay?${[
    q('pa', inv.payeeVpa),
    q('pn', inv.payeeName),
    q('am', majorAmount(inv.totalMinor)),
    q('cu', inv.currency),
    q('tn', inv.number),
  ].join('&')}`
}

export async function toInvoiceDetail(inv: InvoiceRow, now = new Date()): Promise<InvoiceDetail> {
  const base = toInvoice(inv, now)
  if (inv.status !== 'OPEN') return { ...base, upi: null }
  const deepLink = upiDeepLink(inv)
  const qrDataUrl = await QRCode.toDataURL(deepLink, { errorCorrectionLevel: 'M', margin: 2 })
  return { ...base, upi: { deepLink, qrDataUrl } }
}

/** GST only when configured (ML-D3); a single line until the CGST/SGST/IGST split is decided (Q22). */
export function taxFor(subtotal: bigint, manual: ManualBilling): TaxLine[] {
  if (!manual.gst) return []
  const amount = (subtotal * BigInt(manual.gst.rateBps) + 5_000n) / 10_000n
  return [
    {
      label: `GST ${manual.gst.rateBps / 100}%`,
      rateBps: manual.gst.rateBps,
      amountMinor: Number(amount),
    },
  ]
}

/**
 * Issues a payment request. Called inside the operator's commercial operation or by the
 * renewal job; both pass the actor. Refuses when the UPI payee isn't configured.
 */
export async function issueInvoice(
  tx: TenantTx,
  tenantId: string,
  input: {
    kind: 'PLAN_RENEWAL' | 'WALLET_TOPUP'
    subtotalMinor: bigint
    planId?: string | null
    description: string
    dueAt: Date
  },
  manual: ManualBilling,
  actor: { type: 'PLATFORM_OPERATOR' | 'SYSTEM' | 'USER'; id?: string | null },
) {
  if (!manual.payee)
    throw new AppError(
      'UPI_NOT_CONFIGURED',
      422,
      'Set UPI_VPA and UPI_PAYEE_NAME on the server before issuing payment requests.',
    )
  if (input.kind === 'PLAN_RENEWAL') {
    const open = await tx.invoice.findFirst({
      where: { kind: 'PLAN_RENEWAL', status: 'OPEN' },
      select: { number: true },
    })
    if (open)
      throw new AppError(
        'INVOICE_ALREADY_OPEN',
        409,
        `Renewal ${open.number} is still open. Void it before issuing another.`,
      )
  }
  const taxLines = taxFor(input.subtotalMinor, manual)
  const taxMinor = taxLines.reduce((sum, l) => sum + BigInt(l.amountMinor), 0n)
  const number = await nextNumber(tx, 'invoice_number_seq', 'FW-INV')
  const invoice = await tx.invoice.create({
    data: {
      tenantId,
      number,
      kind: input.kind,
      subtotalMinor: input.subtotalMinor,
      taxMinor,
      totalMinor: input.subtotalMinor + taxMinor,
      taxLines: taxLines as Prisma.InputJsonValue,
      planId: input.planId ?? null,
      description: input.description,
      dueAt: input.dueAt,
      payeeVpa: manual.payee.vpa,
      payeeName: manual.payee.name,
      gstin: manual.gst?.gstin ?? null,
      createdByType: actor.type,
      createdById: actor.id ?? null,
    },
    include: INVOICE_INCLUDE,
  })
  await tx.auditLog.create({
    data: {
      tenantId,
      actorType: actor.type,
      actorId: actor.id ?? null,
      action: 'billing.invoice_issued',
      targetType: 'invoice',
      targetId: invoice.id,
      changes: {
        number: invoice.number,
        kind: invoice.kind,
        totalMinor: invoice.totalMinor.toString(),
        dueAt: invoice.dueAt.toISOString(),
      },
    },
  })
  await notifyBillingReaders(tx, tenantId, `invoice:${invoice.id}:issued`, {
    type: 'billing.invoice_issued',
    severity: 'INFO',
    title: `New payment request ${invoice.number}`,
    body: `${invoice.description}. Pay ${invoice.currency} ${majorAmount(invoice.totalMinor)} by UPI before ${invoice.dueAt.toUTCString().slice(0, 16)}.`,
    link: `/billing/invoices?invoice=${invoice.id}`,
  })
  await emitInvoiceNotice(tx, tenantId, invoice.id, 'ISSUED')
  return invoice
}

/**
 * The approval effect, inside the operator's commercial operation (one transaction):
 * proof APPROVED with a receipt number, invoice PAID, then either the subscription extended or
 * activated (ML-D6) or the wallet credited with the pre-tax amount.
 */
export async function applyApprovedPayment(
  tx: TenantTx,
  tenantId: string,
  proofId: string,
  operatorId: string,
  now: Date,
  options: { billing: BillingPlatform; trialPlanKey: string },
) {
  await tx.$queryRaw`SELECT id FROM payment_proofs WHERE id = ${proofId}::uuid FOR UPDATE`
  const proof = await tx.paymentProof.findFirst({ where: { id: proofId } })
  if (!proof) throw AppError.notFound('Payment proof not found.')
  if (proof.status !== 'PENDING')
    throw new AppError('ALREADY_REVIEWED', 409, 'This payment proof was already reviewed.')
  await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${proof.invoiceId}::uuid FOR UPDATE`
  const invoice = await tx.invoice.findFirstOrThrow({
    where: { id: proof.invoiceId },
    include: { plan: true },
  })
  if (invoice.status !== 'OPEN')
    throw new AppError('INVOICE_NOT_OPEN', 409, `Invoice ${invoice.number} is ${invoice.status}.`)

  const receiptNumber = await nextNumber(tx, 'receipt_number_seq', 'FW-RCT')
  await tx.paymentProof.update({
    where: { id: proof.id },
    data: { status: 'APPROVED', reviewedById: operatorId, reviewedAt: now, receiptNumber },
  })
  await tx.invoice.update({ where: { id: invoice.id }, data: { status: 'PAID', paidAt: now } })

  let effect: Record<string, unknown>
  if (invoice.kind === 'WALLET_TOPUP') {
    const ledgerId = await postTransaction(
      tx,
      tenantId,
      {
        type: 'CREDIT',
        amountMinor: invoice.subtotalMinor,
        reason: `UPI payment ${receiptNumber} for ${invoice.number}`,
        referenceType: 'invoice',
        referenceId: invoice.id,
        idempotencyKey: `invoice:${invoice.id}`,
        createdBy: operatorId,
        fundType: 'PAID',
      },
      options.billing,
    )
    effect = { walletCredit: invoice.subtotalMinor.toString(), ledgerId }
  } else {
    if (!invoice.plan) throw new AppError('CONFLICT', 409, 'This renewal has no plan.')
    effect = await extendSubscription(tx, tenantId, invoice.plan.key, now, operatorId, options)
  }
  await notifyBillingReaders(tx, tenantId, `invoice:${invoice.id}:paid`, {
    type: 'billing.payment_approved',
    severity: 'INFO',
    title: `Payment received for ${invoice.number}`,
    body: `Receipt ${receiptNumber}. Thank you.`,
    link: `/billing/invoices?invoice=${invoice.id}`,
  })
  await emitInvoiceNotice(tx, tenantId, invoice.id, 'PAID')
  return { invoiceId: invoice.id, receiptNumber, effect }
}

/**
 * ML-D6: an ACTIVE or PAST_DUE subscription on the same plan is extended from its previous period
 * end (no free days, no lost days); anything else (TRIALING, EXPIRED, CANCELLED, SUSPENDED, or a
 * different plan) is activated from the approval date.
 */
async function extendSubscription(
  tx: TenantTx,
  tenantId: string,
  planKey: string,
  now: Date,
  operatorId: string,
  options: { trialPlanKey: string },
) {
  await tx.$queryRaw`SELECT id FROM subscriptions WHERE tenant_id = ${tenantId}::uuid FOR UPDATE`
  const sub = await tx.subscription.findUnique({ where: { tenantId }, include: { plan: true } })
  const continuing =
    sub &&
    (sub.status === 'ACTIVE' || sub.status === 'PAST_DUE') &&
    sub.plan?.key === planKey &&
    sub.currentPeriodEnd
  if (continuing) {
    const from = sub.currentPeriodEnd!
    const to = addMonth(from)
    const lapsed = to <= now
    await tx.subscription.update({
      where: { tenantId },
      data: {
        status: 'ACTIVE',
        cancelAtPeriodEnd: false,
        ...(sub.status === 'PAST_DUE' ? { currentPeriodStart: from } : {}),
        currentPeriodEnd: lapsed ? addMonth(now) : to,
      },
    })
    await tx.auditLog.create({
      data: {
        tenantId,
        actorType: 'PLATFORM_OPERATOR',
        actorId: operatorId,
        action: 'subscription.renewed',
        targetType: 'subscription',
        targetId: sub.id,
        changes: {
          plan: planKey,
          from: sub.status,
          periodEnd: [from.toISOString(), (lapsed ? addMonth(now) : to).toISOString()],
        },
      },
    })
    return {
      subscription: 'renewed',
      plan: planKey,
      periodEnd: (lapsed ? addMonth(now) : to).toISOString(),
    }
  }
  const changed = await activatePlan(
    tx,
    tenantId,
    planKey,
    now,
    { type: 'PLATFORM_OPERATOR', id: operatorId, note: 'UPI payment approved' },
    options.trialPlanKey,
  )
  return { subscription: 'activated', ...changed }
}

/** Operator rejection: the proof is closed with a reason, the invoice stays OPEN, the UTR is freed. */
export async function rejectPayment(
  tx: TenantTx,
  tenantId: string,
  proofId: string,
  operatorId: string,
  reason: string,
  now: Date,
) {
  const moved = await tx.paymentProof.updateMany({
    where: { id: proofId, status: 'PENDING' },
    data: {
      status: 'REJECTED',
      reviewedById: operatorId,
      reviewedAt: now,
      rejectionReason: reason,
    },
  })
  if (!moved.count) {
    const exists = await tx.paymentProof.findFirst({ where: { id: proofId }, select: { id: true } })
    if (!exists) throw AppError.notFound('Payment proof not found.')
    throw new AppError('ALREADY_REVIEWED', 409, 'This payment proof was already reviewed.')
  }
  const proof = await tx.paymentProof.findFirstOrThrow({
    where: { id: proofId },
    include: { invoice: { select: { id: true, number: true } } },
  })
  await notifyBillingReaders(tx, tenantId, `proof:${proofId}:rejected`, {
    type: 'billing.payment_rejected',
    severity: 'WARNING',
    title: `Payment for ${proof.invoice.number} couldn't be verified`,
    body: `${reason} You can submit the payment proof again.`,
    link: `/billing/invoices?invoice=${proof.invoice.id}`,
  })
  await emitInvoiceNotice(tx, tenantId, proof.invoice.id, 'REJECTED', proofId)
  return { invoiceId: proof.invoice.id, rejected: true }
}

export async function voidInvoice(
  tx: TenantTx,
  invoiceId: string,
  reason: string,
  now: Date,
): Promise<{ invoiceId: string; number: string }> {
  const pending = await tx.paymentProof.count({ where: { invoiceId, status: 'PENDING' } })
  if (pending)
    throw new AppError(
      'PAYMENT_PENDING',
      409,
      'A payment proof is waiting for review. Approve or reject it first.',
    )
  const moved = await tx.invoice.updateMany({
    where: { id: invoiceId, status: 'OPEN' },
    data: { status: 'VOID', voidedAt: now, voidReason: reason },
  })
  const inv = await tx.invoice.findFirst({ where: { id: invoiceId }, select: { number: true } })
  if (!inv) throw AppError.notFound('Invoice not found.')
  if (!moved.count)
    throw new AppError('INVOICE_NOT_OPEN', 409, 'Only an open invoice can be voided.')
  return { invoiceId, number: inv.number }
}

type NotificationCopy = {
  type: string
  severity: 'INFO' | 'WARNING' | 'CRITICAL'
  title: string
  body: string
  link: string
}

export type InvoiceNotice = 'ISSUED' | 'DUE_SOON' | 'OVERDUE' | 'PAID' | 'REJECTED'

/** Notification dedupe key per notice; ISSUED/PAID/REJECTED match notifyBillingReaders' keys. */
export const invoiceNoticeKey = (invoiceId: string, notice: InvoiceNotice, proofId?: string) =>
  notice === 'REJECTED'
    ? `proof:${proofId}:rejected`
    : `invoice:${invoiceId}:${{ ISSUED: 'issued', DUE_SOON: 'due-soon', OVERDUE: 'overdue', PAID: 'paid' }[notice]}`

/** Queues the billing email for this notice (worker: notifications.dispatch), in the same tx. */
export async function emitInvoiceNotice(
  tx: TenantTx,
  tenantId: string,
  invoiceId: string,
  notice: InvoiceNotice,
  proofId?: string,
) {
  await tx.outboxEvent.create({
    data: {
      tenantId,
      eventType: 'billing.invoice_notice',
      aggregateType: 'invoice',
      aggregateId: invoiceId,
      payload: { invoiceId, notice, ...(proofId ? { proofId } : {}) },
    },
  })
}

/** In-app notification for members who can view billing, once per dedupe key and member. */
export async function notifyBillingReaders(
  tx: TenantTx,
  tenantId: string,
  dedupeKey: string,
  copy: NotificationCopy,
) {
  const members = await tx.membership.findMany({
    where: { status: 'ACTIVE', role: { in: BILLING_READER_ROLES } },
    select: { userId: true },
  })
  if (!members.length) return
  await tx.notification.createMany({
    data: members.map((m) => ({ tenantId, userId: m.userId, dedupeKey, ...copy })),
    skipDuplicates: true,
  })
}

/**
 * Upgrade now (Managed Launch): a workspace without an active paid plan (trial, expired, past
 * due, suspended) chooses a public plan and gets its plan invoice at once, at the configured
 * monthly price. One open plan invoice per workspace: choosing the same plan again returns it,
 * choosing another voids it (unless a payment proof is waiting) and issues the new one. Approval
 * activates the plan from the approval date (ML-D6); no proration.
 */
export async function chooseUpgradePlan(
  tx: TenantTx,
  tenantId: string,
  planId: string,
  status: string,
  now: Date,
  manual: ManualBilling,
  userId: string,
): Promise<{ invoiceId: string; replaced: string | null; created: boolean }> {
  if (!manual.enabled)
    throw new AppError('UPGRADE_UNAVAILABLE', 409, 'Plans are activated by the Fenwira team.')
  if (await isInternalWorkspace(tx, tenantId))
    throw new AppError('UPGRADE_UNAVAILABLE', 409, 'This is an internal workspace; billing is off.')
  if (status === 'ACTIVE')
    throw new AppError(
      'PLAN_ACTIVE',
      409,
      'Your plan is active. Use Request change and the Fenwira team will send the invoice.',
    )
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${tenantId}:plan-upgrade`}))`
  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { currency: true },
  })
  const plan = await tx.plan.findFirst({
    where: { id: planId, isPublic: true },
    include: { prices: { where: { active: true, interval: 'MONTH', currency: tenant.currency } } },
  })
  if (!plan) throw AppError.notFound('Plan not found.')
  const price = plan.prices[0]
  if (!price)
    throw new AppError('PLAN_NOT_PRICED', 422, 'This plan has no price yet. Contact Fenwira.')

  const open = await tx.invoice.findFirst({
    where: { kind: 'PLAN_RENEWAL', status: 'OPEN' },
    include: { proofs: { where: { status: 'PENDING' }, select: { id: true } } },
  })
  if (open?.planId === plan.id) return { invoiceId: open.id, replaced: null, created: false }
  if (open?.proofs.length)
    throw new AppError(
      'PAYMENT_PENDING',
      409,
      `A payment for ${open.number} is waiting for review. You can change plan after it is reviewed.`,
    )
  if (open) {
    await voidInvoice(tx, open.id, `Replaced by the ${plan.name} plan choice`, now)
    await tx.auditLog.create({
      data: {
        tenantId,
        actorType: 'USER',
        actorId: userId,
        action: 'billing.invoice_voided',
        targetType: 'invoice',
        targetId: open.id,
        changes: { number: open.number, reason: 'replaced by plan choice' },
      },
    })
  }
  const sub = await tx.subscription.findUnique({
    where: { tenantId },
    select: { trialEndsAt: true },
  })
  const dueAt = new Date(Math.max(sub?.trialEndsAt?.getTime() ?? 0, now.getTime() + DAY))
  const invoice = await issueInvoice(
    tx,
    tenantId,
    {
      kind: 'PLAN_RENEWAL',
      subtotalMinor: price.amountMinor,
      planId: plan.id,
      description: `${plan.name} plan, 1 month from payment confirmation`,
      dueAt,
    },
    manual,
    { type: 'USER', id: userId },
  )
  await tx.subscription.updateMany({
    where: { tenantId },
    data: { requestedPlanId: plan.id, requestedAt: now },
  })
  await tx.auditLog.create({
    data: {
      tenantId,
      actorType: 'USER',
      actorId: userId,
      action: 'subscription.upgrade_chosen',
      targetType: 'invoice',
      targetId: invoice.id,
      changes: { plan: plan.key, number: invoice.number, replaced: open?.number ?? null },
    },
  })
  return { invoiceId: invoice.id, replaced: open?.id ?? null, created: true }
}

/** Days before trial end when the first plan invoice is issued (Managed Launch). */
export const TRIAL_INVOICE_DAYS = 3

/**
 * First plan invoice before a trial ends (Managed Launch). Once per trial period: the key
 * `TRIAL_INVOICE:<trialEndsAt>` is recorded on the subscription, so reruns never duplicate. Skips
 * non-trial workspaces, trials ending later than TRIAL_INVOICE_DAYS, workspaces that already have
 * an open invoice and plans without a price. Approving it activates the plan (ML-D6).
 */
export async function issueTrialInvoiceIfDue(
  tx: TenantTx,
  tenantId: string,
  now: Date,
  manual: ManualBilling,
  trialPlanKey: string,
): Promise<boolean> {
  if (!manual.enabled || !manual.payee) return false
  if (await isInternalWorkspace(tx, tenantId)) return false
  await tx.$queryRaw`SELECT id FROM subscriptions WHERE tenant_id = ${tenantId}::uuid FOR UPDATE`
  const sub = await tx.subscription.findUnique({ where: { tenantId } })
  if (!sub || sub.status !== 'TRIALING' || !sub.trialEndsAt) return false
  if (sub.trialEndsAt.getTime() - now.getTime() > TRIAL_INVOICE_DAYS * DAY) return false
  const key = `TRIAL_INVOICE:${sub.trialEndsAt.toISOString()}`
  if (sub.noticesSent.includes(key)) return false
  if (await tx.invoice.count({ where: { status: 'OPEN' } })) return false
  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { currency: true },
  })
  const plan = await tx.plan.findFirst({
    where: sub.requestedPlanId ? { id: sub.requestedPlanId } : { key: trialPlanKey },
    include: {
      prices: { where: { active: true, interval: 'MONTH', currency: tenant.currency } },
    },
  })
  const price = plan?.prices[0]
  if (!plan || !price) return false
  const dueAt = new Date(Math.max(sub.trialEndsAt.getTime(), now.getTime() + DAY))
  await issueInvoice(
    tx,
    tenantId,
    {
      kind: 'PLAN_RENEWAL',
      subtotalMinor: price.amountMinor,
      planId: plan.id,
      description: `${plan.name} plan, first month (after your free trial)`,
      dueAt,
    },
    manual,
    { type: 'SYSTEM' },
  )
  await tx.subscription.update({
    where: { tenantId },
    data: { noticesSent: { push: key } },
  })
  return true
}

/**
 * The system-issued renewal (ML-D3): once per period (any earlier renewal issued in this lead
 * window, even if voided by an operator, counts), and only when the plan has an active price in
 * the workspace currency. Errors (e.g. UPI payee not configured) are left to the caller's logging.
 */
export async function issueRenewalIfDue(
  tx: TenantTx,
  tenantId: string,
  now: Date,
  manual: ManualBilling,
): Promise<boolean> {
  if (!manual.enabled || !manual.payee) return false
  if (await isInternalWorkspace(tx, tenantId)) return false
  const sub = await tx.subscription.findUnique({ where: { tenantId } })
  if (
    !sub ||
    !(sub.status === 'ACTIVE' || sub.status === 'PAST_DUE') ||
    sub.cancelAtPeriodEnd ||
    !sub.currentPeriodEnd ||
    !sub.planId
  )
    return false
  const { planId, currentPeriodEnd: periodEnd } = sub
  const windowStart = new Date(periodEnd.getTime() - (manual.leadDays + 1) * DAY)
  if (now < new Date(periodEnd.getTime() - manual.leadDays * DAY)) return false
  const issued = await tx.invoice.count({
    where: { kind: 'PLAN_RENEWAL', issuedAt: { gte: windowStart } },
  })
  if (issued) return false
  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { currency: true },
  })
  const plan = await tx.plan.findUnique({
    where: { id: planId },
    include: {
      prices: { where: { active: true, interval: 'MONTH', currency: tenant.currency } },
    },
  })
  const price = plan?.prices[0]
  if (!plan || !price) return false
  await issueInvoice(
    tx,
    tenantId,
    {
      kind: 'PLAN_RENEWAL',
      subtotalMinor: price.amountMinor,
      planId: plan.id,
      description: `${plan.name} plan, 1 month from ${periodEnd.toISOString().slice(0, 10)}`,
      dueAt: periodEnd,
    },
    manual,
    { type: 'SYSTEM' },
  )
  return true
}

/** Global sequential document numbers (FW-INV-000001, FW-RCT-000001). */
async function nextNumber(
  tx: TenantTx,
  sequence: 'invoice_number_seq' | 'receipt_number_seq',
  prefix: string,
): Promise<string> {
  const rows =
    sequence === 'invoice_number_seq'
      ? await tx.$queryRaw<Array<{ n: bigint }>>`SELECT nextval('invoice_number_seq') AS n`
      : await tx.$queryRaw<Array<{ n: bigint }>>`SELECT nextval('receipt_number_seq') AS n`
  return `${prefix}-${String(rows[0]!.n).padStart(6, '0')}`
}

/** Days from now (renewal job due dates). */
export const daysFrom = (now: Date, days: number) => new Date(now.getTime() + days * DAY)

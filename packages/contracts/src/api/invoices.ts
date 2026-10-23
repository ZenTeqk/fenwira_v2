import { z } from 'zod'

/**
 * ADR-0027 Managed Launch Mode step 3: manual UPI billing (docs/BILLING.md → Manual invoices).
 * Tenant-facing amounts are integer minor units (`number`); platform-facing amounts are decimal
 * strings like the rest of the platform contracts.
 */
export const INVOICE_KINDS = ['PLAN_RENEWAL', 'WALLET_TOPUP'] as const
export const INVOICE_STATUSES = ['OPEN', 'PAID', 'VOID'] as const
export const PAYMENT_PROOF_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const
/** What the customer sees: computed from status, due date and a pending proof. */
export const INVOICE_DISPLAY_STATUSES = [
  'DUE',
  'OVERDUE',
  'PAYMENT_SUBMITTED',
  'PAID',
  'VOID',
] as const
export type InvoiceDisplayStatus = (typeof INVOICE_DISPLAY_STATUSES)[number]

/** UTRs are bank references: 6–35 letters/digits once spaces and dashes are removed. */
export const utrSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, '').toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9]{6,35}$/, 'Enter the UTR / reference number from your UPI app'))

const minor = z.number().int().safe()

export const taxLineSchema = z.object({
  label: z.string(),
  rateBps: z.number().int(),
  amountMinor: minor,
})
export type TaxLine = z.infer<typeof taxLineSchema>

export const paymentProofSchema = z.object({
  id: z.uuid(),
  utr: z.string(),
  status: z.enum(PAYMENT_PROOF_STATUSES),
  hasFile: z.boolean(),
  submittedAt: z.string(),
  reviewedAt: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  receiptNumber: z.string().nullable(),
})
export type PaymentProof = z.infer<typeof paymentProofSchema>

export const invoiceSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  kind: z.enum(INVOICE_KINDS),
  status: z.enum(INVOICE_STATUSES),
  displayStatus: z.enum(INVOICE_DISPLAY_STATUSES),
  currency: z.string(),
  subtotalMinor: minor,
  taxMinor: minor,
  totalMinor: minor,
  taxLines: z.array(taxLineSchema),
  description: z.string(),
  plan: z.object({ key: z.string(), name: z.string() }).nullable(),
  dueAt: z.string(),
  issuedAt: z.string(),
  paidAt: z.string().nullable(),
  voidReason: z.string().nullable(),
  payee: z.object({ vpa: z.string(), name: z.string() }),
  gstin: z.string().nullable(),
  receiptNumber: z.string().nullable(),
  proofs: z.array(paymentProofSchema),
})
export type Invoice = z.infer<typeof invoiceSchema>

/** OPEN invoices also carry how to pay: the UPI deep link and its QR code (PNG data URL). */
export const invoiceDetailSchema = invoiceSchema.extend({
  upi: z.object({ deepLink: z.string(), qrDataUrl: z.string() }).nullable(),
})
export type InvoiceDetail = z.infer<typeof invoiceDetailSchema>

export const PAYMENT_PROOF_MIME_TYPES = ['image/png', 'image/jpeg', 'application/pdf'] as const
export const PAYMENT_PROOF_MAX_BYTES = 5 * 1024 * 1024

export const paymentProofUploadRequestSchema = z
  .object({
    filename: z.string().trim().min(1).max(200),
    mimeType: z.enum(PAYMENT_PROOF_MIME_TYPES),
    sizeBytes: z.number().int().min(1).max(PAYMENT_PROOF_MAX_BYTES),
  })
  .strict()
export type PaymentProofUploadRequest = z.infer<typeof paymentProofUploadRequestSchema>

export const submitPaymentProofRequestSchema = z
  .object({ utr: utrSchema, fileId: z.uuid().optional() })
  .strict()
export type SubmitPaymentProofRequest = z.infer<typeof submitPaymentProofRequestSchema>

// --- Platform (operator) --------------------------------------------------------------------

const money = z.string().regex(/^-?\d+$/)

export const createInvoiceRequestSchema = z
  .object({
    kind: z.enum(INVOICE_KINDS),
    /** Before tax, minor units (ML-D3: the operator enters it; prices aren't approved, Q20). */
    amountMinor: z.number().int().positive().max(1_000_000_000_00),
    /** PLAN_RENEWAL: the configured plan this pays for. */
    planKey: z.string().min(1).max(40).optional(),
    description: z.string().trim().min(3).max(200).optional(),
    dueAt: z.iso.datetime({ offset: true }),
    /** Stable per logical request: a retry returns the first invoice's receipt. */
    idempotencyKey: z.uuid(),
  })
  .strict()
  .refine((v) => v.kind !== 'PLAN_RENEWAL' || v.planKey, {
    message: 'A plan renewal needs the plan.',
    path: ['planKey'],
  })
export type CreateInvoiceRequest = z.infer<typeof createInvoiceRequestSchema>

export const voidInvoiceRequestSchema = z
  .object({ reason: z.string().trim().min(3).max(300) })
  .strict()
export const approvePaymentRequestSchema = z
  .object({
    /** What the operator matched in the bank statement (kept on the receipt). */
    reference: z.string().trim().min(3).max(120),
    note: z.string().trim().max(300).optional(),
  })
  .strict()
export type ApprovePaymentRequest = z.infer<typeof approvePaymentRequestSchema>
export const rejectPaymentRequestSchema = z
  .object({ reason: z.string().trim().min(3).max(300) })
  .strict()

export const platformInvoiceSchema = invoiceSchema
  .omit({ subtotalMinor: true, taxMinor: true, totalMinor: true, taxLines: true })
  .extend({
    workspaceId: z.uuid(),
    subtotalMinor: money,
    taxMinor: money,
    totalMinor: money,
    createdByType: z.string(),
  })
export type PlatformInvoice = z.infer<typeof platformInvoiceSchema>

export const pendingPaymentSchema = z.object({
  workspaceId: z.uuid(),
  workspaceName: z.string(),
  proofId: z.uuid(),
  invoiceId: z.uuid(),
  invoiceNumber: z.string(),
  kind: z.enum(INVOICE_KINDS),
  totalMinor: money,
  currency: z.string(),
  utr: z.string(),
  hasFile: z.boolean(),
  submittedAt: z.string(),
})
export type PendingPayment = z.infer<typeof pendingPaymentSchema>

export const billingDashboardSchema = z.object({
  pending: z.array(pendingPaymentSchema),
  overdue: z.array(
    z.object({
      workspaceId: z.uuid(),
      workspaceName: z.string(),
      subscriptionStatus: z.string().nullable(),
      openInvoices: z.number().int(),
      openTotalMinor: money,
      oldestDueAt: z.string().nullable(),
    }),
  ),
  revenue: z.array(
    z.object({
      month: z.string(),
      currency: z.string(),
      totalMinor: money,
      payments: z.number().int(),
    }),
  ),
})
export type BillingDashboard = z.infer<typeof billingDashboardSchema>

export const paymentReviewResultSchema = z.object({
  proofId: z.uuid(),
  status: z.enum(PAYMENT_PROOF_STATUSES),
  invoiceStatus: z.enum(INVOICE_STATUSES),
  receiptNumber: z.string().nullable(),
  operationId: z.uuid().nullable(),
})
export type PaymentReviewResult = z.infer<typeof paymentReviewResultSchema>

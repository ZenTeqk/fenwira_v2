import { uuidv7 } from '@fenwira/config'
import {
  type Invoice,
  type InvoiceDetail,
  type PaymentProofUploadRequest,
  type SubmitPaymentProofRequest,
} from '@fenwira/contracts'
import { Database, Prisma } from '@fenwira/database'
import { Inject, Injectable } from '@nestjs/common'
import { TenantDb } from '../../core/database/tenant-db'
import { AppError } from '../../core/http/app-error'
import { RateLimitService } from '../../core/security/rate-limit.service'
import { StorageService } from '../../core/storage/storage.service'
import { verifyUpload } from '../../core/storage/uploads'
import { AuditService } from '../audit'
import { currentAuth } from '../identity'
import { currentTenant } from '../tenancy'
import { BILLING_OPTIONS, type BillingOptions } from './billing.options'
import { invoiceDocument } from './invoice-document'
import { INVOICE_INCLUDE, toInvoice, toInvoiceDetail } from './invoices.core'

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
const utrTaken = () =>
  new AppError(
    'UTR_ALREADY_USED',
    409,
    'This UTR has already been submitted for a payment. Check the reference in your UPI app.',
  )

/**
 * The customer side of manual UPI billing (ADR-0027 step 3): list and read payment requests, pay
 * by UPI (QR + deep link), and submit proof (UTR + optional screenshot). Reads need billing.read;
 * submitting proof needs billing.manage. Everything runs in the caller's tenant (RLS).
 */
@Injectable()
export class InvoicesService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(BILLING_OPTIONS) private readonly options: BillingOptions,
    private readonly tenantDb: TenantDb,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly limits: RateLimitService,
  ) {}

  async list(): Promise<Invoice[]> {
    const rows = await this.tenantDb.run((tx) =>
      tx.invoice.findMany({
        include: INVOICE_INCLUDE,
        orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
        take: 100,
      }),
    )
    const now = new Date()
    return rows.map((r) => toInvoice(r, now))
  }

  async get(id: string): Promise<InvoiceDetail> {
    const row = await this.tenantDb.run((tx) =>
      tx.invoice.findFirst({ where: { id }, include: INVOICE_INCLUDE }),
    )
    if (!row) throw AppError.notFound('Invoice not found.')
    return toInvoiceDetail(row)
  }

  /** Printable HTML: the payment request, or its receipt once paid. */
  async document(id: string, kind: 'request' | 'receipt'): Promise<string> {
    const { tenantId } = currentTenant()
    const [invoice, tenant] = await Promise.all([
      this.get(id),
      this.tenantDb.run((tx) =>
        tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } }),
      ),
    ])
    if (kind === 'receipt' && invoice.status !== 'PAID')
      throw new AppError('INVOICE_NOT_OPEN', 409, 'A receipt exists only for a paid invoice.')
    return invoiceDocument(invoice, tenant, kind)
  }

  /** Presigned upload for a payment screenshot (PNG, JPEG or PDF up to 5 MB; checked on submit). */
  async createProofUpload(invoiceId: string, input: PaymentProofUploadRequest) {
    const { tenantId } = currentTenant()
    await this.limits.consume([
      { bucket: 'payment-proof-upload:tenant', key: tenantId, limit: 30, windowSeconds: 3600 },
    ])
    const fileId = uuidv7()
    const objectKey = `${tenantId}/payment-proofs/${fileId}`
    await this.tenantDb.run(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: { id: invoiceId },
        select: { status: true },
      })
      if (!invoice) throw AppError.notFound('Invoice not found.')
      if (invoice.status !== 'OPEN')
        throw new AppError('INVOICE_NOT_OPEN', 409, 'This invoice is no longer open.')
      await tx.file.create({
        data: {
          id: fileId,
          tenantId,
          bucket: this.storage.mediaBucket,
          objectKey,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          filename: input.filename,
          purpose: 'PAYMENT_PROOF',
          uploadedBy: currentAuth().userId,
        },
      })
    })
    const expiresIn = 900
    return {
      fileId,
      url: await this.storage.presignPut(
        this.storage.mediaBucket,
        objectKey,
        input.mimeType,
        input.sizeBytes,
        expiresIn,
      ),
      headers: { 'Content-Type': input.mimeType },
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    }
  }

  async submitProof(invoiceId: string, input: SubmitPaymentProofRequest): Promise<InvoiceDetail> {
    const { tenantId } = currentTenant()
    const { userId } = currentAuth()
    await this.limits.consume([
      { bucket: 'payment-proof:tenant', key: tenantId, limit: 20, windowSeconds: 3600 },
    ])
    // The file check talks to S3, so it happens before the transaction.
    if (input.fileId) {
      const file = await this.tenantDb.run((tx) =>
        tx.file.findFirst({ where: { id: input.fileId, purpose: 'PAYMENT_PROOF' } }),
      )
      if (!file) throw AppError.notFound('Uploaded file not found.')
      if (file.status === 'PENDING_UPLOAD') {
        const ok = await verifyUpload(this.storage, file)
        if (ok === null)
          throw new AppError('FILE_NOT_READY', 422, 'The upload has not finished yet.')
        await this.tenantDb.run((tx) =>
          tx.file.update({ where: { id: file.id }, data: { status: ok ? 'READY' : 'REJECTED' } }),
        )
        if (!ok)
          throw AppError.validation([
            {
              path: 'fileId',
              code: 'invalid_file',
              message: 'That file is not a valid image or PDF.',
            },
          ])
      } else if (file.status !== 'READY')
        throw AppError.validation([
          {
            path: 'fileId',
            code: 'invalid_file',
            message: 'That file is not a valid image or PDF.',
          },
        ])
    }
    // A pre-check gives a clear error; the partial unique index is the guarantee.
    if (await this.db.system.utrInUse(input.utr)) throw utrTaken()
    try {
      await this.tenantDb.run(async (tx) => {
        await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId}::uuid FOR UPDATE`
        const invoice = await tx.invoice.findFirst({
          where: { id: invoiceId },
          include: { proofs: { where: { status: 'PENDING' }, select: { id: true } } },
        })
        if (!invoice) throw AppError.notFound('Invoice not found.')
        if (invoice.status !== 'OPEN')
          throw new AppError('INVOICE_NOT_OPEN', 409, 'This invoice is no longer open.')
        if (invoice.proofs.length)
          throw new AppError(
            'PAYMENT_PENDING',
            409,
            'A payment proof for this invoice is already waiting for review.',
          )
        const proof = await tx.paymentProof.create({
          data: {
            tenantId,
            invoiceId,
            utr: input.utr,
            fileId: input.fileId ?? null,
            submittedById: userId,
          },
        })
        await this.audit.write(tx, {
          action: 'billing.payment_proof_submitted',
          targetType: 'invoice',
          targetId: invoiceId,
          changes: {
            number: invoice.number,
            proofId: proof.id,
            utr: input.utr,
            file: !!input.fileId,
          },
        })
      })
    } catch (err) {
      if (isUniqueViolation(err)) {
        const target = String((err as Prisma.PrismaClientKnownRequestError).meta?.target ?? '')
        if (target.includes('invoice'))
          throw new AppError(
            'PAYMENT_PENDING',
            409,
            'A payment proof for this invoice is already waiting for review.',
          )
        throw utrTaken()
      }
      throw err
    }
    return this.get(invoiceId)
  }

  /** Manual billing settings the Invoices page needs (never the GSTIN rules or secrets). */
  configured(): { upi: boolean } {
    return { upi: Boolean(this.options.manual?.payee) }
  }
}

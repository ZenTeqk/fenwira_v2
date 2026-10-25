import {
  type BillingDashboard,
  type InvoiceReminderResult,
  type PlatformInvoice,
} from '@fenwira/contracts'
import { Database } from '@fenwira/database'
import { Inject, Injectable } from '@nestjs/common'
import { requestContext } from '../../core/context/request-context'
import { AppError } from '../../core/http/app-error'
import { StorageService } from '../../core/storage/storage.service'
import {
  INVOICE_INCLUDE,
  emitInvoiceNotice,
  indiaDay,
  invoiceNoticeKey,
  toInvoice,
} from '../billing'
import { PlatformAuthService } from './platform-auth.service'

/**
 * ADR-0027 manual UPI billing, operator reads: the cross-workspace dashboard (pending proofs,
 * overdue workspaces, revenue by month — X22c, billing fields only), a workspace's invoices, and a
 * short-lived link to a payment screenshot (audited). Writes go through CommercialOperationService.
 */
@Injectable()
export class PlatformBillingService {
  constructor(
    @Inject(Database) private readonly db: Database,
    private readonly storage: StorageService,
    private readonly auth: PlatformAuthService,
  ) {}

  private operator(): string {
    const id = requestContext.get()?.platform?.operatorId
    if (!id) throw new AppError('FORBIDDEN', 403, 'Operator session required.')
    return id
  }

  private async workspace(workspaceId: string) {
    const found = await this.db.system.platformWorkspaces(this.operator(), workspaceId, 1)
    if (!found.some((w) => w.id === workspaceId))
      throw new AppError('TENANT_NOT_FOUND', 404, 'Workspace not found.')
  }

  /**
   * Send reminder: emails the workspace's billing readers about every open invoice that has no
   * payment proof waiting, at most once per invoice and India day (the dedupe key carries the
   * day; the notifications worker sends each email once).
   */
  async remind(workspaceId: string, now = new Date()): Promise<InvoiceReminderResult> {
    const operatorId = this.operator()
    await this.workspace(workspaceId)
    const day = indiaDay(now)
    const result = await this.db.withTenant(workspaceId, async (tx) => {
      const invoices = await tx.invoice.findMany({
        where: { status: 'OPEN', proofs: { none: { status: 'PENDING' } } },
        select: { id: true },
      })
      if (!invoices.length)
        throw new AppError(
          'INVOICE_NOT_OPEN',
          409,
          'This workspace has no unpaid invoice to remind about (or its payment is being verified).',
        )
      let sent = 0,
        alreadyToday = 0
      for (const inv of invoices) {
        const key = invoiceNoticeKey(inv.id, 'REMINDER', undefined, day)
        if (await tx.notification.findFirst({ where: { dedupeKey: key }, select: { id: true } })) {
          alreadyToday++
          continue
        }
        await emitInvoiceNotice(tx, workspaceId, inv.id, 'REMINDER', undefined, day)
        sent++
      }
      await tx.auditLog.create({
        data: {
          tenantId: workspaceId,
          actorType: 'PLATFORM_OPERATOR',
          actorId: operatorId,
          action: 'invoice.reminder_sent',
          targetType: 'workspace',
          targetId: workspaceId,
          changes: { sent, alreadyToday },
          correlationId: requestContext.correlationId() ?? null,
        },
      })
      return { sent, alreadyToday }
    })
    await this.auth.audit('platform.invoice_reminder_sent', 'SUCCESS', operatorId)
    return result
  }

  async dashboard(now = new Date()): Promise<BillingDashboard> {
    const operator = this.operator()
    const [pending, overdue, revenue] = await Promise.all([
      this.db.system.platformPendingProofs(operator, 200),
      this.db.system.platformOverdueWorkspaces(operator, now),
      this.db.system.platformRevenueByMonth(operator, 12),
    ])
    return {
      pending: pending.map((p) => ({
        workspaceId: p.tenant_id,
        workspaceName: p.workspace_name,
        proofId: p.proof_id,
        invoiceId: p.invoice_id,
        invoiceNumber: p.invoice_number,
        kind: p.kind as 'PLAN_RENEWAL' | 'WALLET_TOPUP',
        totalMinor: p.total_minor.toString(),
        currency: p.currency,
        utr: p.utr,
        hasFile: p.has_file,
        submittedAt: p.submitted_at.toISOString(),
      })),
      overdue: overdue.map((o) => ({
        workspaceId: o.tenant_id,
        workspaceName: o.workspace_name,
        subscriptionStatus: o.subscription_status,
        openInvoices: o.open_invoices,
        openTotalMinor: o.open_total_minor.toString(),
        oldestDueAt: o.oldest_due_at?.toISOString() ?? null,
      })),
      revenue: revenue.map((r) => ({
        month: r.month.toISOString().slice(0, 7),
        currency: r.currency,
        totalMinor: r.total_minor.toString(),
        payments: r.payments,
      })),
    }
  }

  async invoices(workspaceId: string): Promise<PlatformInvoice[]> {
    await this.workspace(workspaceId)
    const rows = await this.db.withTenant(workspaceId, (tx) =>
      tx.invoice.findMany({
        include: INVOICE_INCLUDE,
        orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
        take: 100,
      }),
    )
    const now = new Date()
    return rows.map((r) => {
      const {
        subtotalMinor: _s,
        taxMinor: _t,
        totalMinor: _tt,
        taxLines: _l,
        ...base
      } = toInvoice(r, now)
      return {
        ...base,
        workspaceId,
        subtotalMinor: r.subtotalMinor.toString(),
        taxMinor: r.taxMinor.toString(),
        totalMinor: r.totalMinor.toString(),
        createdByType: r.createdByType,
      }
    })
  }

  /** A 2-minute link to the customer's payment screenshot; every view is platform-audited. */
  async proofFile(workspaceId: string, proofId: string) {
    await this.workspace(workspaceId)
    const file = await this.db.withTenant(workspaceId, async (tx) => {
      const proof = await tx.paymentProof.findFirst({
        where: { id: proofId },
        include: { file: true },
      })
      if (!proof) throw AppError.notFound('Payment proof not found.')
      return proof.file && proof.file.status === 'READY' ? proof.file : null
    })
    if (!file) throw AppError.notFound('This payment proof has no screenshot.')
    await this.auth.audit('platform.payment_proof_viewed', 'SUCCESS', this.operator(), workspaceId)
    const expiresIn = 120
    return {
      url: await this.storage.presignGet(file.bucket, file.objectKey, expiresIn),
      mimeType: file.mimeType,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    }
  }
}

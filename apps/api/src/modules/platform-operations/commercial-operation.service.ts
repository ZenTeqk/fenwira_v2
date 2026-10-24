import {
  subscriptionOperationSchema,
  entitlementOperationSchema,
  type SubscriptionOperation,
  type EntitlementOperation,
  commercialPreviewSchema,
  ENTITLEMENT_KEYS,
  CAPABILITY_KEYS,
  type CommercialPreview,
  walletOperationSchema,
  commercialReceiptSchema,
  type WalletOperation,
  type ApprovePaymentRequest,
  type CreateInvoiceRequest,
  type PaymentReviewResult,
} from '@fenwira/contracts'
import { Database, Prisma, type TenantTx } from '@fenwira/database'
import { Inject, Injectable } from '@nestjs/common'
import { MetricsService } from '../../core/metrics/metrics.service'
import { CORE_CONFIG, type CoreConfig } from '../../core/config/core-config'
import { requestContext } from '../../core/context/request-context'
import { AppError } from '../../core/http/app-error'
import {
  activatePlan,
  applyApprovedPayment,
  availableOf,
  issueInvoice,
  rejectPayment,
  voidInvoice,
  BILLING_OPTIONS,
  type BillingOptions,
  lockWallet,
  postTransaction,
} from '../billing'
import { SubscriptionEntitlementSource } from '../entitlements'
import { commercialSnapshot } from './commercial-read.service'
import {
  commercialJson,
  commercialOperation,
  fingerprint,
  type OperationInput,
} from './operation.core'
import { FRESH_MFA_MS, PRIVILEGE_IDLE_MS, PlatformAuthService } from './platform-auth.service'

class PreviewRollback extends Error {
  constructor(readonly preview: CommercialPreview) {
    super('Preview rolled back')
  }
}

@Injectable()
export class CommercialOperationService {
  constructor(
    private readonly metrics: MetricsService,
    @Inject(Database) private readonly db: Database,
    private readonly auth: PlatformAuthService,
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
    @Inject(BILLING_OPTIONS) private readonly billing: BillingOptions,
  ) {}
  /** Recheck current privilege inside the operation transaction, including retry requests. */
  private async actor(tx: TenantTx) {
    const actor = requestContext.get()?.platform
    if (!actor) throw new AppError('FORBIDDEN', 403, 'Operator session required.')
    const [grant, session, user, credential] = await Promise.all([
      tx.platformGrant.findUnique({ where: { userId: actor.operatorId } }),
      tx.platformSession.findUnique({ where: { id: actor.sessionId } }),
      tx.user.findUnique({ where: { id: actor.operatorId } }),
      tx.twoFactorCredential.findUnique({ where: { userId: actor.operatorId } }),
    ])
    const now = Date.now()
    const parent =
      session &&
      (await tx.session.findFirst({
        where: { familyId: session.parentFamilyId, revokedAt: null, expiresAt: { gt: new Date() } },
      }))
    if (
      !grant ||
      grant.revokedAt ||
      !session ||
      session.userId !== actor.operatorId ||
      session.grantVersion !== grant.version ||
      session.revokedAt ||
      session.expiresAt.getTime() <= now ||
      session.lastUsedAt.getTime() + PRIVILEGE_IDLE_MS <= now ||
      !user?.emailVerifiedAt ||
      user.disabledAt ||
      !credential?.enabledAt ||
      !parent
    )
      throw new AppError('FORBIDDEN', 403, 'Operator authorization ended.')
    if (session.mfaAt.getTime() + FRESH_MFA_MS <= now)
      throw new AppError('TOTP_REQUIRED', 403, 'Fresh MFA required.')
    return actor.operatorId
  }
  async run<T extends OperationInput>(
    tenantId: string,
    input: T,
    mutate: (tx: TenantTx, operatorId: string) => Promise<unknown>,
    preview = false,
  ) {
    const actor = requestContext.get()?.platform?.operatorId
    try {
      const receipt = await this.db.withTenant(tenantId, async (tx) => {
        const operatorId = await this.actor(tx)
        // Serialize operator state changes; wallet lock also serializes with messaging reservations.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${tenantId}:commercial-state`}))`
        await commercialSnapshot(tx, tenantId)
        // Lock an existing wallet without initializing it before the reviewed snapshot.
        await tx.$queryRaw`SELECT id FROM wallets WHERE tenant_id = ${tenantId}::uuid FOR UPDATE`
        const existed = await tx.commercialOperation.findUnique({
          where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } },
        })
        const receipt = await commercialOperation(
          tx,
          tenantId,
          operatorId,
          input,
          async () => commercialJson(await commercialSnapshot(tx, tenantId)),
          async () => commercialJson(await mutate(tx, operatorId)),
        )
        if (preview) {
          const configured = await new SubscriptionEntitlementSource({
            enforced: true,
            trialDays: this.config.entitlements?.trialDays ?? 14,
            trialPlanKey: this.config.entitlements?.trialPlanKey ?? 'GROWTH',
          }).resolve(tx, tenantId)
          throw new PreviewRollback(
            commercialPreviewSchema.parse(
              commercialJson({
                version: fingerprint(receipt.before),
                before: receipt.before,
                after: receipt.after,
                result: receipt.result,
                entitlements: ENTITLEMENT_KEYS.map((key) => ({
                  key,
                  configured:
                    configured.values.get(key) ??
                    ((CAPABILITY_KEYS as readonly string[]).includes(key) ? true : null),
                })),
              }),
            ),
          )
        }
        return { receipt, replay: !!existed }
      })
      this.metrics.commercialOperations.inc({
        operation: input.kind,
        result: receipt.replay ? 'replay' : 'committed',
      })
      return commercialReceiptSchema.parse(commercialJson(receipt.receipt))
    } catch (err) {
      if (err instanceof PreviewRollback) {
        await this.auth.audit('commercial.preview', 'SUCCESS', actor, tenantId)
        return err.preview
      }
      await this.auth.audit(
        `commercial.${input.kind}`,
        err instanceof AppError ? err.code : 'FAILED',
        actor,
        tenantId,
        {
          operation: input.kind,
          amountMinor: input.amountMinor,
          currency: input.currency,
          reason: input.reason,
          reference: input.reference,
          idempotencyKey: input.idempotencyKey,
        },
      )
      throw err
    }
  }
  async subscription(tenantId: string, raw: SubscriptionOperation, preview = false) {
    const input = subscriptionOperationSchema.parse(raw)
    return this.run(
      tenantId,
      input,
      async (tx, operatorId) => {
        await tx.$queryRaw`SELECT id FROM subscriptions WHERE tenant_id = ${tenantId}::uuid FOR UPDATE`
        if (input.kind === 'activate') {
          const plan = await tx.plan.findUnique({ where: { id: input.planId } })
          if (!plan) throw AppError.notFound('Plan not found.')
          return activatePlan(
            tx,
            tenantId,
            plan.key,
            new Date(),
            { type: 'PLATFORM_OPERATOR', id: operatorId, note: input.reason },
            this.config.entitlements?.trialPlanKey ?? 'GROWTH',
          )
        }
        if (input.kind === 'billing_mode') {
          await tx.tenant.update({ where: { id: tenantId }, data: { billingMode: input.mode } })
          return { billingMode: input.mode }
        }
        if (input.kind === 'internal_flag') {
          await tx.tenant.update({ where: { id: tenantId }, data: { isInternal: input.internal } })
          return { isInternal: input.internal }
        }
        const moved = await tx.subscription.updateMany({
          where: { tenantId, status: 'ACTIVE' },
          data: { cancelAtPeriodEnd: true },
        })
        if (!moved.count)
          throw new AppError('CONFLICT', 409, 'Only an active subscription can be cancelled.')
        return { cancelAtPeriodEnd: true }
      },
      preview,
    )
  }
  async entitlement(tenantId: string, raw: EntitlementOperation, preview = false) {
    const input = entitlementOperationSchema.parse(raw)
    return this.run(
      tenantId,
      input,
      async (tx, operatorId) => {
        if (input.kind === 'override_remove') {
          await tx.tenantEntitlementOverride.deleteMany({ where: { tenantId, key: input.key } })
          return { key: input.key, removed: true }
        }
        if (input.expiresAt && new Date(input.expiresAt) <= new Date())
          throw AppError.validation([
            { path: 'expiresAt', code: 'future', message: 'Expiry must be in the future.' },
          ])
        const value = input.value === null ? Prisma.JsonNull : input.value
        // Prisma represents JSON null through its explicit sentinel, not SQL NULL.
        const data = {
          value: value as never,
          reason: input.reason,
          createdBy: operatorId,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        }
        await tx.tenantEntitlementOverride.upsert({
          where: { tenantId_key: { tenantId, key: input.key } },
          create: { tenantId, key: input.key, ...data },
          update: data,
        })
        return { key: input.key, value: input.value, expiresAt: data.expiresAt }
      },
      preview,
    )
  }
  async wallet(tenantId: string, raw: WalletOperation, preview = false) {
    const input = walletOperationSchema.parse(raw)
    return this.run(
      tenantId,
      input,
      async (tx, operatorId) => {
        const wallet = await lockWallet(tx, tenantId, this.billing)
        if (wallet.currency !== input.currency)
          throw AppError.validation([
            { path: 'currency', code: 'currency', message: 'Currency must match this wallet.' },
          ])
        if (
          input.kind === 'adjustment' &&
          input.amountMinor < 0 &&
          availableOf(wallet) + BigInt(input.amountMinor) < 0n
        )
          throw new AppError(
            'INSUFFICIENT_BALANCE',
            422,
            'Adjustment would reduce available funds below zero after reservations.',
          )
        let fundType: 'PAID' | 'PROMOTIONAL' =
          input.kind === 'promotional_credit' ? 'PROMOTIONAL' : 'PAID'
        if (input.kind === 'refund') {
          const debit = await tx.walletTransaction.findFirst({
            where: {
              id: input.debitId,
              walletId: wallet.id,
              type: 'DEBIT',
              referenceType: 'message',
              amountMinor: { lt: 0 },
            },
          })
          if (!debit) throw AppError.notFound('Eligible usage debit not found in this workspace.')
          const refunded = await tx.walletTransaction.aggregate({
            where: { type: 'REFUND', referenceType: 'wallet_transaction', referenceId: debit.id },
            _sum: { amountMinor: true },
          })
          if ((refunded._sum.amountMinor ?? 0n) + BigInt(input.amountMinor) > -debit.amountMinor)
            throw new AppError(
              'UNPROCESSABLE',
              422,
              'Refund exceeds the original debit less earlier refunds.',
            )
          fundType = debit.fundType
        }
        if (
          input.kind === 'promotional_credit' &&
          input.expiresAt &&
          new Date(input.expiresAt) <= new Date()
        )
          throw AppError.validation([
            {
              path: 'expiresAt',
              code: 'future',
              message: 'Expiry metadata must be in the future.',
            },
          ])
        const ledgerId = await postTransaction(
          tx,
          tenantId,
          {
            type:
              input.kind === 'refund'
                ? 'REFUND'
                : input.kind === 'adjustment'
                  ? 'ADJUSTMENT'
                  : 'CREDIT',
            amountMinor: BigInt(input.amountMinor),
            reason: input.reason,
            referenceType: input.kind === 'refund' ? 'wallet_transaction' : 'commercial_reference',
            referenceId: input.kind === 'refund' ? input.debitId : input.reference,
            idempotencyKey: `commercial:${input.idempotencyKey}`,
            createdBy: operatorId,
            fundType,
            ...(input.kind === 'promotional_credit' && input.expiresAt
              ? { expiresAt: new Date(input.expiresAt) }
              : {}),
          },
          this.billing,
        )
        return { ledgerId }
      },
      preview,
    )
  }

  // ------------------------------------------------------------------------------------------
  // ADR-0027 manual UPI billing (docs/BILLING.md → Manual invoices). Same privilege recheck,
  // serialization, immutable receipt, tenant + platform audit and outbox as every operation above.
  // ------------------------------------------------------------------------------------------

  private get manual() {
    const manual = this.billing.manual
    if (!manual) throw new AppError('UPI_NOT_CONFIGURED', 422, 'Manual billing is not configured.')
    return manual
  }

  async issueInvoice(tenantId: string, input: CreateInvoiceRequest) {
    const manual = this.manual
    // Managed Launch: customers have no wallet; Meta bills message charges directly.
    if (manual.enabled && input.kind === 'WALLET_TOPUP')
      throw new AppError(
        'WALLET_TOPUP_DISABLED',
        422,
        'Wallet top-up invoices are off in Managed Launch. Issue a plan invoice instead.',
      )
    return this.run(
      tenantId,
      {
        kind: 'invoice_issue',
        reason:
          input.description ?? (input.kind === 'PLAN_RENEWAL' ? 'Plan renewal' : 'Wallet top-up'),
        reference: `${input.kind}:${input.planKey ?? '-'}:${input.dueAt}`,
        idempotencyKey: `invoice:${input.idempotencyKey}`,
        amountMinor: input.amountMinor,
        currency: 'INR',
      },
      async (tx, operatorId) => {
        const plan = input.planKey
          ? await tx.plan.findUnique({ where: { key: input.planKey } })
          : null
        if (input.kind === 'PLAN_RENEWAL' && !plan) throw AppError.notFound('Plan not found.')
        const dueAt = new Date(input.dueAt)
        const invoice = await issueInvoice(
          tx,
          tenantId,
          {
            kind: input.kind,
            subtotalMinor: BigInt(input.amountMinor),
            planId: plan?.id ?? null,
            description:
              input.description ??
              (plan ? `${plan.name} plan, 1 month` : 'Wallet top-up (WhatsApp message credits)'),
            dueAt,
          },
          manual,
          { type: 'PLATFORM_OPERATOR', id: operatorId },
        )
        return { invoiceId: invoice.id, number: invoice.number, totalMinor: invoice.totalMinor }
      },
    )
  }

  async voidInvoice(tenantId: string, invoiceId: string, reason: string) {
    return this.run(
      tenantId,
      {
        kind: 'invoice_void',
        reason,
        reference: invoiceId,
        idempotencyKey: `invoice-void:${invoiceId}`,
      },
      (tx) => voidInvoice(tx, invoiceId, reason, new Date()),
    )
  }

  /**
   * Approve a payment proof. The idempotency key is derived from the proof, so a retried approval
   * returns the original receipt and a proof can be reviewed only once (approve or reject).
   */
  async approvePayment(
    tenantId: string,
    proofId: string,
    input: ApprovePaymentRequest,
  ): Promise<PaymentReviewResult> {
    const proof = await this.proofFor(tenantId, proofId)
    await this.review(() =>
      this.run(
        tenantId,
        {
          kind: 'payment_approval',
          reason: input.note ?? 'UPI payment verified',
          reference: input.reference,
          idempotencyKey: `payment-review:${proofId}`,
          amountMinor: Number(proof.invoice.totalMinor),
          currency: proof.invoice.currency,
        },
        (tx, operatorId) =>
          applyApprovedPayment(tx, tenantId, proofId, operatorId, new Date(), {
            billing: this.billing,
            trialPlanKey: this.config.entitlements?.trialPlanKey ?? 'GROWTH',
          }),
      ),
    )
    return this.reviewResult(tenantId, proofId)
  }

  async rejectPayment(
    tenantId: string,
    proofId: string,
    reason: string,
  ): Promise<PaymentReviewResult> {
    const proof = await this.proofFor(tenantId, proofId)
    await this.review(() =>
      this.run(
        tenantId,
        {
          kind: 'payment_rejection',
          reason,
          reference: proof.utr,
          idempotencyKey: `payment-review:${proofId}`,
        },
        (tx, operatorId) => rejectPayment(tx, tenantId, proofId, operatorId, reason, new Date()),
      ),
    )
    return this.reviewResult(tenantId, proofId)
  }

  private async proofFor(tenantId: string, proofId: string) {
    const proof = await this.db.withTenant(tenantId, (tx) =>
      tx.paymentProof.findFirst({
        where: { id: proofId },
        include: { invoice: { select: { totalMinor: true, currency: true } } },
      }),
    )
    if (!proof) throw AppError.notFound('Payment proof not found.')
    return proof
  }

  /** A second, different review of the same proof reuses its key: report it plainly. */
  private async review(fn: () => Promise<unknown>) {
    try {
      await fn()
    } catch (err) {
      if (err instanceof AppError && err.code === 'IDEMPOTENCY_KEY_REUSED')
        throw new AppError('ALREADY_REVIEWED', 409, 'This payment proof was already reviewed.')
      throw err
    }
  }

  private async reviewResult(tenantId: string, proofId: string): Promise<PaymentReviewResult> {
    return this.db.withTenant(tenantId, async (tx) => {
      const p = await tx.paymentProof.findFirstOrThrow({
        where: { id: proofId },
        include: { invoice: { select: { id: true, status: true } } },
      })
      const op = await tx.commercialOperation.findUnique({
        where: {
          tenantId_idempotencyKey: { tenantId, idempotencyKey: `payment-review:${proofId}` },
        },
        select: { id: true },
      })
      if (op && p.status === 'APPROVED')
        await tx.invoice.updateMany({
          where: { id: p.invoice.id, commercialOperationId: null },
          data: { commercialOperationId: op.id },
        })
      return {
        proofId,
        status: p.status,
        invoiceStatus: p.invoice.status,
        receiptNumber: p.receiptNumber,
        operationId: op?.id ?? null,
      }
    })
  }
}

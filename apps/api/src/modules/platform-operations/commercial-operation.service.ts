import {
  walletOperationSchema,
  commercialReceiptSchema,
  type WalletOperation,
} from '@fenwira/contracts'
import { Database, type TenantTx } from '@fenwira/database'
import { Inject, Injectable } from '@nestjs/common'
import { requestContext } from '../../core/context/request-context'
import { AppError } from '../../core/http/app-error'
import {
  availableOf,
  BILLING_OPTIONS,
  type BillingOptions,
  lockWallet,
  postTransaction,
} from '../billing'
import { commercialSnapshot } from './commercial-read.service'
import { commercialJson, commercialOperation, type OperationInput } from './operation.core'
import { FRESH_MFA_MS, PRIVILEGE_IDLE_MS, PlatformAuthService } from './platform-auth.service'

@Injectable()
export class CommercialOperationService {
  constructor(
    @Inject(Database) private readonly db: Database,
    private readonly auth: PlatformAuthService,
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
  ) {
    const actor = requestContext.get()?.platform?.operatorId
    try {
      const receipt = await this.db.withTenant(tenantId, async (tx) => {
        const operatorId = await this.actor(tx)
        // Serialize operator state changes; wallet lock also serializes with messaging reservations.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${tenantId}:commercial-state`}))`
        await commercialSnapshot(tx, tenantId)
        await lockWallet(tx, tenantId, this.billing)
        return commercialOperation(
          tx,
          tenantId,
          operatorId,
          input,
          async () => commercialJson(await commercialSnapshot(tx, tenantId)),
          async () => commercialJson(await mutate(tx, operatorId)),
        )
      })
      return commercialReceiptSchema.parse(commercialJson(receipt))
    } catch (err) {
      await this.auth.audit(
        `commercial.${input.kind}`,
        err instanceof AppError ? err.code : 'FAILED',
        actor,
        tenantId,
      )
      throw err
    }
  }
  async wallet(tenantId: string, raw: WalletOperation) {
    const input = walletOperationSchema.parse(raw)
    return this.run(tenantId, input, async (tx, operatorId) => {
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
          where: { id: input.debitId, walletId: wallet.id, type: 'DEBIT', amountMinor: { lt: 0 } },
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
          { path: 'expiresAt', code: 'future', message: 'Expiry metadata must be in the future.' },
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
    })
  }
}

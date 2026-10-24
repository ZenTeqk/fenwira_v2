import {
  ENTITLEMENT_KEYS,
  CAPABILITY_KEYS,
  type LimitKey,
  type PlatformWorkspace,
  type PlatformFinancial,
  commercialSnapshotSchema,
  platformWorkspaceSchema,
  platformFinancialSchema,
  commercialReceiptSchema,
} from '@fenwira/contracts'
import { Database, type TenantTx } from '@fenwira/database'
import { Inject, Injectable } from '@nestjs/common'
import { CORE_CONFIG, type CoreConfig } from '../../core/config/core-config'
import { requestContext } from '../../core/context/request-context'
import { AppError } from '../../core/http/app-error'
import { EntitlementsService, SubscriptionEntitlementSource } from '../entitlements'
import { ledgerFigures } from '../billing'
import { commercialJson, fingerprint } from './operation.core'
import { PlatformAuthService } from './platform-auth.service'

export async function commercialSnapshot(tx: TenantTx, tenantId: string) {
  const workspace = await tx.tenant.findFirst({
    where: { id: tenantId, deletedAt: null },
    select: {
      id: true,
      name: true,
      slug: true,
      createdAt: true,
      billingMode: true,
      isInternal: true,
    },
  })
  if (!workspace) throw AppError.notFound('Workspace not found.')
  const [sub, wallet, overrides] = await Promise.all([
    tx.subscription.findUnique({
      where: { tenantId },
      select: {
        id: true,
        status: true,
        planId: true,
        trialEndsAt: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
        requestedPlanId: true,
      },
    }),
    tx.wallet.findUnique({
      where: { tenantId },
      select: {
        id: true,
        currency: true,
        balanceMinor: true,
        reservedMinor: true,
        creditLimitMinor: true,
      },
    }),
    tx.tenantEntitlementOverride.findMany({
      orderBy: { key: 'asc' },
      select: { key: true, value: true, reason: true, expiresAt: true },
    }),
  ])
  return commercialSnapshotSchema.parse(
    commercialJson({
      workspace,
      subscription: sub,
      wallet: wallet
        ? {
            ...wallet,
            availableMinor: wallet.balanceMinor + wallet.creditLimitMinor - wallet.reservedMinor,
          }
        : null,
      overrides,
    }),
  )
}
@Injectable()
export class CommercialReadService {
  constructor(
    @Inject(Database) private readonly db: Database,
    private readonly entitlements: EntitlementsService,
    private readonly auth: PlatformAuthService,
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
  ) {}
  private operator() {
    const actor = requestContext.get()?.platform?.operatorId
    if (!actor) throw new AppError('FORBIDDEN', 403, 'Platform authorization required.')
    return actor
  }
  async search(q: string, limit: number) {
    const operator = this.operator()
    const rows = await this.db.system.platformWorkspaces(operator, q, limit)
    await this.auth.audit('commercial.workspace_search', 'SUCCESS', operator)
    return rows
  }
  async workspace(tenantId: string): Promise<PlatformWorkspace> {
    const operator = this.operator()
    const result = await this.db.withTenant(tenantId, async (tx) => {
      // Consistent wallet/ledger/hold snapshot while ordinary messaging updates continue outside this transaction.
      await tx.$queryRaw`SELECT id FROM wallets WHERE tenant_id = ${tenantId}::uuid FOR SHARE`
      let snapshot = await commercialSnapshot(tx, tenantId)
      const configured = await new SubscriptionEntitlementSource({
        enforced: true,
        trialDays: this.config.entitlements?.trialDays ?? 14,
        trialPlanKey: this.config.entitlements?.trialPlanKey ?? 'GROWTH',
      }).resolve(tx, tenantId)
      snapshot = await commercialSnapshot(tx, tenantId)
      const entitlements = []
      for (const key of ENTITLEMENT_KEYS) {
        const capability = (CAPABILITY_KEYS as readonly string[]).includes(key)
        const value = configured.values.get(key) ?? (capability ? true : null)
        const usage = capability ? null : await this.entitlements.usage(tx, key as LimitKey)
        entitlements.push({
          key,
          configured: value,
          enforced: capability
            ? await this.entitlements.isEnabled(tx, tenantId, key as never)
            : await this.entitlements.getLimit(tx, tenantId, key as LimitKey),
          usage,
          overLimit: typeof value === 'number' && usage !== null && usage > value,
        })
      }
      const [credits, operations, ledger, plans] = await Promise.all([
        tx.walletTransaction.groupBy({
          by: ['fundType'],
          where: { type: 'CREDIT' },
          _sum: { amountMinor: true },
        }),
        tx.commercialOperation.findMany({
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 30,
        }),
        tx.walletTransaction.findMany({
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 50,
          select: {
            id: true,
            type: true,
            fundType: true,
            amountMinor: true,
            reason: true,
            referenceId: true,
            referenceType: true,
            expiresAt: true,
            createdAt: true,
          },
        }),
        tx.plan.findMany({ orderBy: { sort: 'asc' }, select: { id: true, key: true, name: true } }),
      ])
      const figures = snapshot.wallet ? await ledgerFigures(tx, snapshot.wallet.id) : null
      return platformWorkspaceSchema.parse(
        commercialJson({
          snapshot,
          version: fingerprint(snapshot),
          subscriptionsEnforced: this.config.entitlements?.enforced ?? false,
          entitlements,
          credits: credits.map((c) => ({
            fundType: c.fundType,
            grantedMinor: c._sum.amountMinor ?? 0n,
          })),
          operations,
          ledger,
          plans,
          reconciliation: {
            balanceMatches: !figures || figures.balanceMinor === figures.ledgerMinor,
            reservationsMatch: !figures || figures.reservedMinor === figures.activeHoldsMinor,
          },
        }),
      )
    })
    await this.auth.audit('commercial.workspace_viewed', 'SUCCESS', operator, tenantId)
    return result
  }
  async financial(tenantId: string): Promise<PlatformFinancial> {
    const operator = this.operator()
    const result = await this.db.withTenant(tenantId, async (tx) => {
      const snapshot = await commercialSnapshot(tx, tenantId)
      const currency = snapshot.wallet?.currency ?? 'INR'
      const [all, known, taxMetadata] = await Promise.all([
        tx.usageEvent.aggregate({ where: { currency }, _sum: { amountMinor: true }, _count: true }),
        tx.usageEvent.aggregate({
          where: { currency, providerCostMinor: { not: null } },
          _sum: { amountMinor: true, providerCostMinor: true },
          _count: true,
        }),
        tx.priceBookEntry.findMany({
          where: { currency, effectiveTo: null },
          take: 50,
          select: { category: true, taxCode: true, taxBps: true, isPlaceholder: true },
        }),
      ])
      const cost = known._sum.providerCostMinor
      return platformFinancialSchema.parse(
        commercialJson({
          currency,
          customerChargeMinor: all._sum.amountMinor ?? 0n,
          providerCostMinor: cost,
          knownCostCustomerChargeMinor: known._sum.amountMinor ?? 0n,
          recordedContributionMinor: cost === null ? null : (known._sum.amountMinor ?? 0n) - cost,
          messages: all._count,
          costKnownMessages: known._count,
          costProvenance:
            'Recorded price-book snapshots; historical placeholder classification unavailable. Not verified provider invoices.',
          taxMetadata,
        }),
      )
    })
    await this.auth.audit('commercial.internal_financial_viewed', 'SUCCESS', operator, tenantId)
    return result
  }
  async receipts(tenantId: string) {
    this.operator()
    return this.db.withTenant(tenantId, async (tx) => {
      await commercialSnapshot(tx, tenantId)
      return (
        await tx.commercialOperation.findMany({
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 100,
        })
      ).map((r) => commercialReceiptSchema.parse(commercialJson(r)))
    })
  }
  async audit() {
    return this.db.withPlatform(this.operator(), (tx) =>
      tx.platformAudit.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 }),
    )
  }
}

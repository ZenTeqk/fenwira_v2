import {
  type RequestPlan,
  requestPlanSchema,
  type WalletTransactionsQuery,
  walletTransactionsQuerySchema,
  type WorkspaceStatus,
} from '@fenwira/contracts'
import { Body, Controller, Get, Header, HttpCode, Post, Query } from '@nestjs/common'
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe'
import { RequirePermission } from '../../core/security/decorators'
import { currentTenant } from '../tenancy'
import { BillingService } from './billing.service'
import { SubscriptionsService } from './subscriptions.service'

const exportSchema = walletTransactionsQuerySchema.pick({ type: true, from: true, to: true })

/** Wallet (docs/API_SPEC.md → Billing; Phase 11 Step 1). */
@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  /** Public plans and their entitlements; `price` is null until prices are approved (P11-D4). */
  @Get('plans')
  @RequirePermission('billing.read')
  async plans() {
    return { data: await this.subscriptions.plans() }
  }

  @Get('subscription')
  @RequirePermission('billing.read')
  async subscription() {
    return { data: await this.subscriptions.subscription() }
  }

  /** Every role can read limits: it's what explains a LIMIT_EXCEEDED. */
  @Get('entitlements')
  @RequirePermission('workspace.read')
  async entitlements() {
    return { data: await this.subscriptions.entitlementStatus() }
  }

  /** P11-D24: the OWNER requests a plan; the Fenwira team activates it. */
  @Post('subscription/request')
  @HttpCode(200)
  @RequirePermission('billing.manage')
  async requestPlan(@Body(new ZodValidationPipe(requestPlanSchema)) body: RequestPlan) {
    return { data: await this.subscriptions.requestPlan(body.planId) }
  }

  /** Ends the active subscription at the end of its period. */
  @Post('subscription/cancel')
  @HttpCode(200)
  @RequirePermission('billing.manage')
  async cancel() {
    return { data: await this.subscriptions.cancel() }
  }

  @Get('wallet')
  @RequirePermission('billing.read')
  async wallet() {
    return { data: await this.billing.wallet() }
  }

  @Get('wallet/transactions')
  @RequirePermission('billing.read')
  transactions(
    @Query(new ZodValidationPipe(walletTransactionsQuerySchema)) query: WalletTransactionsQuery,
  ) {
    return this.billing.transactions(query)
  }

  /** The filtered ledger as CSV (synchronous, capped, audited). */
  @Post('wallet/transactions/export')
  @HttpCode(200)
  @RequirePermission('billing.read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="wallet-transactions.csv"')
  @Header('Cache-Control', 'no-store')
  exportTransactions(
    @Body(new ZodValidationPipe(exportSchema))
    body: Pick<WalletTransactionsQuery, 'type' | 'from' | 'to'>,
  ): Promise<string> {
    return this.billing.exportTransactions(body)
  }
}

/** Shell and dashboard summary: state the backend owns (docs/plans/PHASE_11_PLAN.md §2.3). */
@Controller('workspace')
export class WorkspaceStatusController {
  constructor(
    private readonly billing: BillingService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  /** Every role holds workspace.read, so every member gets the state. */
  @Get('status')
  @RequirePermission('workspace.read')
  async status(): Promise<{ data: WorkspaceStatus }> {
    // Wallet and subscription are separate concepts, reported side by side (P11-D9).
    const [wallet, subscription] = await Promise.all([
      this.billing.status(currentTenant().permissions),
      this.subscriptions.banner(),
    ])
    return { data: { ...wallet, subscription } }
  }
}

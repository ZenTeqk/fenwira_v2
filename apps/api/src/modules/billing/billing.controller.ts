import {
  type WalletTransactionsQuery,
  walletTransactionsQuerySchema,
  type WorkspaceStatus,
} from '@fenwira/contracts'
import { Body, Controller, Get, Header, HttpCode, Post, Query } from '@nestjs/common'
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe'
import { RequirePermission } from '../../core/security/decorators'
import { currentTenant } from '../tenancy'
import { BillingService } from './billing.service'

const exportSchema = walletTransactionsQuerySchema.pick({ type: true, from: true, to: true })

/** Wallet (docs/API_SPEC.md → Billing; Phase 11 Step 1). */
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

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
  constructor(private readonly billing: BillingService) {}

  /** Every role holds workspace.read, so every member gets the state. */
  @Get('status')
  @RequirePermission('workspace.read')
  async status(): Promise<{ data: WorkspaceStatus }> {
    return { data: await this.billing.status(currentTenant().permissions) }
  }
}

import { Controller, Get } from '@nestjs/common'
import { RequirePermission } from '../../core/security/decorators'
import { BillingService } from './billing.service'

/** Wallet summary (Phase 9 slice of docs/API_SPEC.md → Billing; the rest arrives in Phase 11). */
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('wallet')
  @RequirePermission('billing.read')
  async wallet() {
    return { data: await this.billing.wallet() }
  }
}

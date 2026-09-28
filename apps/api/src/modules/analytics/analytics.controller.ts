import { type AnalyticsRangeQuery, analyticsRangeQuerySchema } from '@fenwira/contracts'
import { Controller, Get, Query } from '@nestjs/common'
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe'
import { RequirePermission } from '../../core/security/decorators'
import { currentTenant } from '../tenancy'
import { AnalyticsService } from './analytics.service'

const range = new ZodValidationPipe(analyticsRangeQuerySchema)

/**
 * Analytics views (docs/ANALYTICS.md → API). Same range contract everywhere: `from`/`to` are
 * workspace-local days. Money needs `billing.read` too: the Usage view requires it, and the
 * Overview returns its charge only to members who have it.
 */
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  @RequirePermission('analytics.read')
  async overview(@Query(range) q: AnalyticsRangeQuery) {
    return this.analytics.overview(q, currentTenant().permissions.includes('billing.read'))
  }

  @Get('messaging')
  @RequirePermission('analytics.read')
  messaging(@Query(range) q: AnalyticsRangeQuery) {
    return this.analytics.messaging(q)
  }

  @Get('campaigns')
  @RequirePermission('analytics.read')
  campaigns(@Query(range) q: AnalyticsRangeQuery) {
    return this.analytics.campaigns(q)
  }

  @Get('inbox')
  @RequirePermission('analytics.read')
  inbox(@Query(range) q: AnalyticsRangeQuery) {
    return this.analytics.inbox(q)
  }

  @Get('automations')
  @RequirePermission('analytics.read')
  automations(@Query(range) q: AnalyticsRangeQuery) {
    return this.analytics.automations(q)
  }

  /** Customer charges and promotional credits (money): billing.read. */
  @Get('usage')
  @RequirePermission('billing.read')
  usage(@Query(range) q: AnalyticsRangeQuery) {
    return this.analytics.usage(q)
  }
}

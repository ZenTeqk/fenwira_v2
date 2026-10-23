import { setPlanPriceSchema, type SetPlanPrice } from '@fenwira/contracts'
import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common'
import { z } from 'zod'
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe'
import { PlatformAccess } from '../../core/security/decorators'
import { PlatformPlansService } from './platform-plans.service'

const planKey = new ZodValidationPipe(z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/))

/** Plan prices (operator-editable; fresh MFA for the write via `.manage`). */
@Controller('platform/plans')
export class PlatformPlansController {
  constructor(private readonly plans: PlatformPlansService) {}

  @PlatformAccess('commercial.read')
  @Get()
  async list() {
    return { data: await this.plans.list() }
  }

  @PlatformAccess('subscription.manage')
  @Post(':planKey/price')
  @HttpCode(200)
  async setPrice(
    @Param('planKey', planKey) key: string,
    @Body(new ZodValidationPipe(setPlanPriceSchema)) body: SetPlanPrice,
  ) {
    return { data: await this.plans.setPrice(key, body) }
  }
}

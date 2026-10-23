import { accessRequestSchema, type AccessRequestInput } from '@fenwira/contracts'
import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common'
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe'
import { PlatformAccess, Public, PublicSite } from '../../core/security/decorators'
import { LeadsService } from './leads.service'

/** Marketing-site Request access form (cookieless; CORS/CSRF limited to the site's origins). */
@Controller('public')
export class PublicLeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Public()
  @PublicSite()
  @Post('request-access')
  @HttpCode(200)
  async requestAccess(
    @Body(new ZodValidationPipe(accessRequestSchema)) body: AccessRequestInput,
  ): Promise<{ data: { received: true } }> {
    await this.leads.submit(body)
    return { data: { received: true } }
  }
}

/** Operator console list (docs/runbooks/PLATFORM_OPERATIONS.md). */
@Controller('platform')
export class PlatformLeadsController {
  constructor(private readonly leads: LeadsService) {}

  @PlatformAccess('commercial.read')
  @Get('access-requests')
  async list() {
    return { data: await this.leads.list() }
  }
}

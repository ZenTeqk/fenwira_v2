import { updateResponseAlertSettingsSchema } from '@fenwira/contracts'
import { Body, Controller, Get, Patch } from '@nestjs/common'
import { z } from 'zod'
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe'
import { RequirePermission } from '../../core/security/decorators'
import { ResponseAlertsService } from './response-alerts.service'

/** Settings → Inbox → Response alerts (docs/API_SPEC.md → Response alerts). */
@Controller('inbox/response-alerts')
export class ResponseAlertsController {
  constructor(private readonly alerts: ResponseAlertsService) {}

  @Get()
  @RequirePermission('inbox.alerts.manage')
  async get() {
    return { data: await this.alerts.get() }
  }

  @Patch()
  @RequirePermission('inbox.alerts.manage')
  async update(
    @Body(new ZodValidationPipe(updateResponseAlertSettingsSchema))
    body: z.infer<typeof updateResponseAlertSettingsSchema>,
  ) {
    return { data: await this.alerts.update(body) }
  }
}

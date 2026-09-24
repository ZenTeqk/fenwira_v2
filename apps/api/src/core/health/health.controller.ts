import { Controller, Get, Res } from '@nestjs/common'
import { type Response } from 'express'
import { Public } from '../security/decorators'
import { HealthService } from './health.service'

/** Outside the /api/v1 prefix (docs/API_SPEC.md → Health). Public: probes carry no session. */
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  async summary(@Res() res: Response): Promise<void> {
    const report = await this.health.readiness()
    res.status(report.status === 'ok' ? 200 : 503).json(report)
  }

  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' }
  }

  @Get('ready')
  async ready(@Res() res: Response): Promise<void> {
    const report = await this.health.readiness()
    res.status(report.status === 'ok' ? 200 : 503).json(report)
  }
}

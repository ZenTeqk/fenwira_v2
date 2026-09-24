import { Controller, Get, Header, Res } from '@nestjs/common'
import { type Response } from 'express'
import { MetricsService } from './metrics.service'

/** GET /metrics for the worker's internal health server (the API uses METRICS_PORT instead). */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async get(@Res() res: Response): Promise<void> {
    res.type(this.metrics.contentType).send(await this.metrics.metrics())
  }
}

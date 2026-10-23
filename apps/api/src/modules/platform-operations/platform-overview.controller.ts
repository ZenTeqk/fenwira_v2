import { Controller, Get, Param } from '@nestjs/common'
import { z } from 'zod'
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe'
import { PlatformAccess } from '../../core/security/decorators'
import { PlatformOverviewService } from './platform-overview.service'

/** /platform overview dashboard and workspace activity (operators only). */
@Controller('platform')
export class PlatformOverviewController {
  constructor(private readonly overview: PlatformOverviewService) {}

  @PlatformAccess('financial.read')
  @Get('overview')
  async get() {
    return { data: await this.overview.overview() }
  }

  @PlatformAccess('commercial.read')
  @Get('workspaces/:workspaceId/activity')
  async activity(@Param('workspaceId', new ZodValidationPipe(z.uuid())) workspaceId: string) {
    return { data: await this.overview.activity(workspaceId) }
  }
}

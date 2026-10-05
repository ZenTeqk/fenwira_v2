import { platformSearchSchema } from '@fenwira/contracts'
import { Controller, Get, Param, Query } from '@nestjs/common'
import { z } from 'zod'
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe'
import { PlatformAccess } from '../../core/security/decorators'
import { CommercialReadService } from './commercial-read.service'
@Controller('platform')
export class CommercialReadController {
  constructor(private readonly reads: CommercialReadService) {}
  @PlatformAccess('commercial.read')
  @Get('workspaces')
  async search(
    @Query(new ZodValidationPipe(platformSearchSchema)) query: z.infer<typeof platformSearchSchema>,
  ) {
    return { data: await this.reads.search(query.q, query.limit) }
  }
  @PlatformAccess('commercial.read')
  @Get('workspaces/:workspaceId')
  async workspace(@Param('workspaceId', new ZodValidationPipe(z.uuid())) id: string) {
    return { data: await this.reads.workspace(id) }
  }
  @PlatformAccess('financial.read')
  @Get('workspaces/:workspaceId/financial')
  async financial(@Param('workspaceId', new ZodValidationPipe(z.uuid())) id: string) {
    return { data: await this.reads.financial(id) }
  }
  @PlatformAccess('audit.read')
  @Get('workspaces/:workspaceId/operations')
  async operations(@Param('workspaceId', new ZodValidationPipe(z.uuid())) id: string) {
    return { data: await this.reads.receipts(id) }
  }
  @PlatformAccess('audit.read')
  @Get('audit')
  async audit() {
    return { data: await this.reads.audit() }
  }
}

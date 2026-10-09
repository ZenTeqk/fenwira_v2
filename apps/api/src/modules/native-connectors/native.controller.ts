import { nativeSetupSchema, nativeCallbackSchema, nativeTransferSchema } from '@fenwira/contracts'
import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common'
import { z } from 'zod'
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe'
import { RequirePermission } from '../../core/security/decorators'
import { NativeService } from './native.service'
const idPipe = new ZodValidationPipe(z.uuid())
@Controller('native-connectors')
export class NativeController {
  constructor(private readonly service: NativeService) {}
  @Get()
  @RequirePermission('integrations.manage')
  async list() {
    return { data: await this.service.list() }
  }
  @Post('connect')
  @RequirePermission('integrations.manage')
  async begin(
    @Body(new ZodValidationPipe(nativeSetupSchema)) body: z.infer<typeof nativeSetupSchema>,
  ) {
    return { data: await this.service.begin(body) }
  }
  @Post('oauth/complete')
  @RequirePermission('integrations.manage')
  async complete(
    @Body(new ZodValidationPipe(nativeCallbackSchema)) body: z.infer<typeof nativeCallbackSchema>,
  ) {
    return { data: await this.service.complete(body) }
  }
  @Delete(':id')
  @RequirePermission('integrations.manage')
  @HttpCode(204)
  async disconnect(@Param('id', idPipe) id: string) {
    await this.service.disconnect(id)
  }
  @Get(':id/transfers')
  @RequirePermission('integrations.manage')
  async transfers(@Param('id', idPipe) id: string) {
    return { data: await this.service.transfers(id) }
  }
  @Post(':id/transfers')
  @RequirePermission('integrations.manage')
  @HttpCode(202)
  async start(
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(nativeTransferSchema)) body: z.infer<typeof nativeTransferSchema>,
  ) {
    return { data: await this.service.start(id, body) }
  }
  @Post(':id/transfers/:transferId/retry')
  @RequirePermission('integrations.manage')
  @HttpCode(202)
  async retry(@Param('id', idPipe) id: string, @Param('transferId', idPipe) transferId: string) {
    return { data: await this.service.retry(id, transferId) }
  }
}

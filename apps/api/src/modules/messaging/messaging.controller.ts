import { type FileDto, uploadUrlRequestSchema } from '@fenwira/contracts'
import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common'
import { z } from 'zod'
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe'
import { RequirePermission } from '../../core/security/decorators'
import { FilesService } from './files.service'

const uuidParam = new ZodValidationPipe(z.uuid())

@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post('upload-url')
  @RequirePermission('inbox.reply')
  @HttpCode(201)
  async uploadUrl(
    @Body(new ZodValidationPipe(uploadUrlRequestSchema))
    body: z.infer<typeof uploadUrlRequestSchema>,
  ) {
    return { data: await this.files.createUpload(body) }
  }

  @Post(':id/complete')
  @RequirePermission('inbox.reply')
  @HttpCode(200)
  async complete(@Param('id', uuidParam) id: string): Promise<{ data: FileDto }> {
    return { data: await this.files.complete(id) }
  }

  @Get(':id/download-url')
  @RequirePermission('inbox.read')
  async downloadUrl(@Param('id', uuidParam) id: string) {
    return { data: await this.files.downloadUrl(id) }
  }
}

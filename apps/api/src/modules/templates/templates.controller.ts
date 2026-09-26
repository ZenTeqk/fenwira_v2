import {
  approvedTemplatesQuerySchema,
  createTemplateSchema,
  templateDraftSchema,
  templatesQuerySchema,
  updateTemplateSchema,
  templateSampleUploadSchema,
} from '@fenwira/contracts'
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common'
import { z } from 'zod'
import { IdempotencyInterceptor } from '../../core/http/idempotency.interceptor'
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe'
import { RequirePermission } from '../../core/security/decorators'
import { TemplatesService } from './templates.service'

const uuidParam = new ZodValidationPipe(z.uuid())
const pipe = <T extends z.ZodType>(schema: T) => new ZodValidationPipe(schema)
type In<T extends z.ZodType> = z.infer<T>
const validateRequestSchema = templateDraftSchema.extend({
  wabaId: z.uuid().optional(),
  templateId: z.uuid().optional(),
})
const syncRequestSchema = z.object({ wabaId: z.uuid().optional() })

/** docs/API_SPEC.md → Templates. Static paths are declared before `:id`. */
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  @RequirePermission('templates.read')
  async list(@Query(pipe(templatesQuerySchema)) query: In<typeof templatesQuerySchema>) {
    return { data: await this.templates.list(query) }
  }

  @Get('approved')
  @RequirePermission('templates.read')
  async approved(
    @Query(pipe(approvedTemplatesQuerySchema)) query: In<typeof approvedTemplatesQuerySchema>,
  ) {
    return { data: await this.templates.approved(query) }
  }

  @Get('accounts')
  @RequirePermission('templates.read')
  async accounts() {
    return { data: await this.templates.accounts() }
  }

  @Post()
  @RequirePermission('templates.write')
  async create(@Body(pipe(createTemplateSchema)) body: In<typeof createTemplateSchema>) {
    return { data: await this.templates.create(body) }
  }

  /** Dry run: the same validation the builder shows, plus server-only checks. */
  @Post('validate')
  @RequirePermission('templates.read')
  @HttpCode(200)
  async validate(@Body(pipe(validateRequestSchema)) body: In<typeof validateRequestSchema>) {
    const { templateId, ...draft } = body
    return { data: await this.templates.validate(draft, templateId) }
  }

  @Post('sync')
  @RequirePermission('templates.write')
  @HttpCode(200)
  async sync(@Body(pipe(syncRequestSchema)) body: In<typeof syncRequestSchema>) {
    return { data: await this.templates.sync(body.wabaId) }
  }

  @Post('samples/upload-url')
  @RequirePermission('templates.write')
  async sampleUpload(
    @Body(pipe(templateSampleUploadSchema)) body: In<typeof templateSampleUploadSchema>,
  ) {
    return { data: await this.templates.sampleUpload(body) }
  }

  @Post('samples/:fileId/complete')
  @RequirePermission('templates.write')
  @HttpCode(200)
  async completeSample(@Param('fileId', uuidParam) fileId: string) {
    return { data: await this.templates.completeSample(fileId) }
  }

  @Get('samples/:fileId/url')
  @RequirePermission('templates.read')
  async sampleUrl(@Param('fileId', uuidParam) fileId: string) {
    return { data: await this.templates.sampleUrl(fileId) }
  }

  @Get(':id')
  @RequirePermission('templates.read')
  async get(@Param('id', uuidParam) id: string) {
    return { data: await this.templates.get(id) }
  }

  @Patch(':id')
  @RequirePermission('templates.write')
  async update(
    @Param('id', uuidParam) id: string,
    @Body(pipe(updateTemplateSchema)) body: In<typeof updateTemplateSchema>,
  ) {
    return { data: await this.templates.update(id, body) }
  }

  @Delete(':id')
  @RequirePermission('templates.write')
  @HttpCode(204)
  async remove(@Param('id', uuidParam) id: string): Promise<void> {
    await this.templates.remove(id)
  }

  @Get(':id/versions')
  @RequirePermission('templates.read')
  async versions(@Param('id', uuidParam) id: string) {
    return { data: await this.templates.versions(id) }
  }

  @Post(':id/versions')
  @RequirePermission('templates.write')
  async newVersion(@Param('id', uuidParam) id: string) {
    return { data: await this.templates.newVersion(id) }
  }

  @Post(':id/submit')
  @RequirePermission('templates.submit')
  @UseInterceptors(IdempotencyInterceptor)
  @HttpCode(200)
  async submit(@Param('id', uuidParam) id: string) {
    return { data: await this.templates.submit(id) }
  }
}

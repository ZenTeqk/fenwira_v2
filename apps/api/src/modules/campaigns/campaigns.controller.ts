import {
  CAMPAIGN_STATUSES,
  createCampaignSchema,
  recipientsQuerySchema,
  updateCampaignSchema,
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
  StreamableFile,
  UseInterceptors,
} from '@nestjs/common'
import { z } from 'zod'
import { IdempotencyInterceptor } from '../../core/http/idempotency.interceptor'
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe'
import { PublicApi, RequirePermission } from '../../core/security/decorators'
import { CampaignsService } from './campaigns.service'

const uuidParam = new ZodValidationPipe(z.uuid())
const pipe = <T extends z.ZodType>(schema: T) => new ZodValidationPipe(schema)
type In<T extends z.ZodType> = z.infer<T>
const listQuerySchema = z.object({ status: z.enum(CAMPAIGN_STATUSES).optional() })

/** docs/API_SPEC.md → Campaigns. */
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  @RequirePermission('campaigns.read')
  @PublicApi()
  async list(@Query(pipe(listQuerySchema)) q: In<typeof listQuerySchema>) {
    return { data: await this.campaigns.list(q.status) }
  }

  @Post()
  @RequirePermission('campaigns.write')
  async create(@Body(pipe(createCampaignSchema)) body: In<typeof createCampaignSchema>) {
    return { data: await this.campaigns.create(body) }
  }

  @Get(':id')
  @RequirePermission('campaigns.read')
  @PublicApi()
  async get(@Param('id', uuidParam) id: string) {
    return { data: await this.campaigns.get(id) }
  }

  @Patch(':id')
  @RequirePermission('campaigns.write')
  async update(
    @Param('id', uuidParam) id: string,
    @Body(pipe(updateCampaignSchema)) body: In<typeof updateCampaignSchema>,
  ) {
    return { data: await this.campaigns.update(id, body) }
  }

  @Delete(':id')
  @RequirePermission('campaigns.write')
  @HttpCode(204)
  async remove(@Param('id', uuidParam) id: string): Promise<void> {
    await this.campaigns.remove(id)
  }

  /** The Review step: audience evaluated without a snapshot. */
  @Post(':id/estimate')
  @RequirePermission('campaigns.read')
  @HttpCode(200)
  async estimate(@Param('id', uuidParam) id: string) {
    return { data: await this.campaigns.estimate(id) }
  }

  @Post(':id/launch')
  @RequirePermission('campaigns.launch')
  @UseInterceptors(IdempotencyInterceptor)
  @HttpCode(200)
  async launch(@Param('id', uuidParam) id: string) {
    return { data: await this.campaigns.launch(id) }
  }

  @Post(':id/unschedule')
  @RequirePermission('campaigns.launch')
  @HttpCode(200)
  async unschedule(@Param('id', uuidParam) id: string) {
    return { data: await this.campaigns.unschedule(id) }
  }

  @Post(':id/pause')
  @RequirePermission('campaigns.launch')
  @HttpCode(200)
  async pause(@Param('id', uuidParam) id: string) {
    return { data: await this.campaigns.pause(id) }
  }

  @Post(':id/resume')
  @RequirePermission('campaigns.launch')
  @HttpCode(200)
  async resume(@Param('id', uuidParam) id: string) {
    return { data: await this.campaigns.resume(id) }
  }

  @Post(':id/cancel')
  @RequirePermission('campaigns.launch')
  @HttpCode(200)
  async cancel(@Param('id', uuidParam) id: string) {
    return { data: await this.campaigns.cancel(id) }
  }

  @Get(':id/stats')
  @RequirePermission('campaigns.read')
  @PublicApi()
  async stats(@Param('id', uuidParam) id: string) {
    return { data: await this.campaigns.stats(id) }
  }

  @Get(':id/recipients')
  @RequirePermission('campaigns.read')
  async recipients(
    @Param('id', uuidParam) id: string,
    @Query(pipe(recipientsQuerySchema)) q: In<typeof recipientsQuerySchema>,
  ) {
    const { items, nextCursor } = await this.campaigns.recipients(id, q)
    return { data: items, page: { nextCursor } }
  }

  /** CSV of recipients with statuses and reasons (streamed). */
  @Post(':id/recipients/export')
  @RequirePermission('contacts.export')
  @HttpCode(200)
  async export(@Param('id', uuidParam) id: string): Promise<StreamableFile> {
    return new StreamableFile(await this.campaigns.exportRecipients(id), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="campaign-${id}-recipients.csv"`,
    })
  }
}

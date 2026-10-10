import {
  createFlowSchema,
  executionsQuerySchema,
  putDraftSchema,
  updateFlowSchema,
} from '@fenwira/contracts'
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  type RawBodyRequest,
  Req,
  Res,
  UseInterceptors,
} from '@nestjs/common'
import { type Request, type Response } from 'express'
import { z } from 'zod'
import { IdempotencyInterceptor } from '../../core/http/idempotency.interceptor'
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe'
import { Public, RequirePermission, SkipCsrf } from '../../core/security/decorators'
import { FlowsService } from './flows.service'

const uuidParam = new ZodValidationPipe(z.uuid())
const pipe = <T extends z.ZodType>(schema: T) => new ZodValidationPipe(schema)
type In<T extends z.ZodType> = z.infer<T>

/** docs/API_SPEC.md → Automation. */
@Controller('flows')
export class FlowsController {
  constructor(private readonly flows: FlowsService) {}

  @Get()
  @RequirePermission('automations.read')
  async list() {
    return { data: await this.flows.list() }
  }

  @Post()
  @RequirePermission('automations.write')
  async create(@Body(pipe(createFlowSchema)) body: In<typeof createFlowSchema>) {
    return { data: await this.flows.create(body) }
  }

  @Get(':id')
  @RequirePermission('automations.read')
  async get(@Param('id', uuidParam) id: string) {
    return { data: await this.flows.get(id) }
  }

  @Patch(':id')
  @RequirePermission('automations.write')
  async update(
    @Param('id', uuidParam) id: string,
    @Body(pipe(updateFlowSchema)) body: In<typeof updateFlowSchema>,
  ) {
    return { data: await this.flows.update(id, body) }
  }

  @Delete(':id')
  @RequirePermission('automations.write')
  @HttpCode(204)
  async remove(@Param('id', uuidParam) id: string): Promise<void> {
    await this.flows.remove(id)
  }

  @Get(':id/draft')
  @RequirePermission('automations.read')
  async draft(@Param('id', uuidParam) id: string, @Res({ passthrough: true }) res: Response) {
    const v = await this.flows.getDraft(id)
    res.setHeader('ETag', v.etag)
    return { data: v }
  }

  /** Optimistic concurrency: If-Match must be the etag the editor loaded (409 VERSION_CONFLICT). */
  @Put(':id/draft')
  @RequirePermission('automations.write')
  async saveDraft(
    @Param('id', uuidParam) id: string,
    @Body(pipe(putDraftSchema)) body: In<typeof putDraftSchema>,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.flows.putDraft(id, body.graph, ifMatch)
    res.setHeader('ETag', v.etag)
    return { data: v }
  }

  @Post(':id/validate')
  @RequirePermission('automations.read')
  @HttpCode(200)
  async validate(@Param('id', uuidParam) id: string) {
    return { data: await this.flows.validate(id) }
  }

  @Post(':id/publish')
  @RequirePermission('automations.publish')
  @UseInterceptors(IdempotencyInterceptor)
  @HttpCode(200)
  async publish(@Param('id', uuidParam) id: string) {
    return { data: await this.flows.publish(id) }
  }

  @Post(':id/pause')
  @RequirePermission('automations.publish')
  @HttpCode(200)
  async pause(@Param('id', uuidParam) id: string) {
    return { data: await this.flows.pause(id) }
  }

  @Post(':id/resume')
  @RequirePermission('automations.publish')
  @HttpCode(200)
  async resume(@Param('id', uuidParam) id: string) {
    return { data: await this.flows.resume(id) }
  }

  @Get(':id/versions')
  @RequirePermission('automations.read')
  async versions(@Param('id', uuidParam) id: string) {
    return { data: await this.flows.versions(id) }
  }

  @Get(':id/versions/:versionId')
  @RequirePermission('automations.read')
  async version(
    @Param('id', uuidParam) id: string,
    @Param('versionId', uuidParam) versionId: string,
  ) {
    return { data: await this.flows.version(id, versionId) }
  }

  /** Rotates the inbound webhook token and HMAC secret; both are shown once. */
  @Post(':id/webhook-token')
  @RequirePermission('automations.write')
  @HttpCode(200)
  async rotateToken(@Param('id', uuidParam) id: string) {
    return { data: await this.flows.rotateWebhookToken(id) }
  }

  @Get(':id/executions')
  @RequirePermission('automations.read')
  async executions(
    @Param('id', uuidParam) id: string,
    @Query(pipe(executionsQuerySchema)) q: In<typeof executionsQuerySchema>,
  ) {
    const { items, nextCursor } = await this.flows.executions(id, q)
    return { data: items, page: { nextCursor } }
  }

  @Get(':id/trigger-runs/:runId')
  @RequirePermission('automations.read')
  async triggerRun(@Param('id', uuidParam) id: string, @Param('runId', uuidParam) runId: string) {
    return { data: await this.flows.triggerRun(id, runId) }
  }
}

@Controller('executions')
export class ExecutionsController {
  constructor(private readonly flows: FlowsService) {}

  @Get(':id')
  @RequirePermission('automations.read')
  async get(@Param('id', uuidParam) id: string) {
    return { data: await this.flows.execution(id) }
  }

  @Post(':id/cancel')
  @RequirePermission('automations.publish')
  @HttpCode(200)
  async cancel(@Param('id', uuidParam) id: string) {
    return { data: await this.flows.cancel(id) }
  }
}

const tokenParam = new ZodValidationPipe(z.string().regex(/^[A-Za-z0-9_-]{32,64}$/))

/** Inbound automation webhooks. Public: the token names the flow; X-Fenwira-Signature proves it. */
@Controller('webhooks/automation')
@Public()
@SkipCsrf()
export class AutomationWebhookController {
  constructor(private readonly flows: FlowsService) {}

  @Post(':token')
  @HttpCode(202)
  async receive(
    @Param('token', tokenParam) token: string,
    @Req() req: RawBodyRequest<Request>,
    @Body() body: unknown,
    @Headers('x-fenwira-signature') signature: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    const key = idempotencyKey?.trim()
    return {
      data: await this.flows.receiveWebhook(
        token,
        req.rawBody,
        body,
        signature,
        key && key.length <= 128 ? key : undefined,
      ),
    }
  }
}

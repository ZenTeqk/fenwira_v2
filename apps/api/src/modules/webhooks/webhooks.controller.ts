import {
  createWebhookEndpointRequestSchema,
  updateWebhookEndpointRequestSchema,
  webhookDeliveriesQuerySchema,
} from '@fenwira/contracts'
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common'
import { z } from 'zod'
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe'
import { RequirePermission } from '../../core/security/decorators'
import { WebhooksService } from './webhooks.service'

const uuidParam = new ZodValidationPipe(z.uuid())
const pipe = <T extends z.ZodType>(schema: T) => new ZodValidationPipe(schema)
type In<T extends z.ZodType> = z.infer<T>

/** Outbound webhook endpoints (docs/WEBHOOKS.md). `integrations.manage`, never `@PublicApi`. */
@Controller('webhook-endpoints')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  @RequirePermission('integrations.manage')
  async list() {
    const [data, entitled] = await Promise.all([this.webhooks.list(), this.webhooks.entitled()])
    // meta.entitled false = suspended by plan: endpoints are kept, nothing is delivered.
    return { data, meta: { entitled } }
  }

  /** The signing secret is returned once, here, and never again. */
  @Post()
  @RequirePermission('integrations.manage')
  @HttpCode(201)
  async create(
    @Body(pipe(createWebhookEndpointRequestSchema))
    body: In<typeof createWebhookEndpointRequestSchema>,
  ) {
    return { data: await this.webhooks.create(body) }
  }

  @Patch(':id')
  @RequirePermission('integrations.manage')
  async update(
    @Param('id', uuidParam) id: string,
    @Body(pipe(updateWebhookEndpointRequestSchema))
    body: In<typeof updateWebhookEndpointRequestSchema>,
  ) {
    return { data: await this.webhooks.update(id, body) }
  }

  @Delete(':id')
  @RequirePermission('integrations.manage')
  @HttpCode(204)
  async remove(@Param('id', uuidParam) id: string): Promise<void> {
    await this.webhooks.remove(id)
  }

  /** A new signing secret, returned once. The old one stops verifying immediately. */
  @Post(':id/rotate-secret')
  @RequirePermission('integrations.manage')
  async rotateSecret(@Param('id', uuidParam) id: string) {
    return { data: await this.webhooks.rotateSecret(id) }
  }

  @Get(':id/deliveries')
  @RequirePermission('integrations.manage')
  async deliveries(
    @Param('id', uuidParam) id: string,
    @Query(pipe(webhookDeliveriesQuerySchema)) query: In<typeof webhookDeliveriesQuerySchema>,
  ) {
    return this.webhooks.deliveries(id, query)
  }

  @Get(':id/deliveries/:deliveryId')
  @RequirePermission('integrations.manage')
  async delivery(
    @Param('id', uuidParam) id: string,
    @Param('deliveryId', uuidParam) deliveryId: string,
  ) {
    return { data: await this.webhooks.delivery(id, deliveryId) }
  }

  @Post(':id/deliveries/:deliveryId/retry')
  @RequirePermission('integrations.manage')
  @HttpCode(204)
  async retry(
    @Param('id', uuidParam) id: string,
    @Param('deliveryId', uuidParam) deliveryId: string,
  ): Promise<void> {
    await this.webhooks.retry(id, deliveryId)
  }

  /** Sends one synthetic delivery so an integrator can verify their receiver end to end. */
  @Post(':id/test')
  @RequirePermission('integrations.manage')
  async test(@Param('id', uuidParam) id: string) {
    return { data: await this.webhooks.test(id) }
  }
}

import { createApiKeyRequestSchema } from '@fenwira/contracts'
import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common'
import { z } from 'zod'
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe'
import { RequirePermission } from '../../core/security/decorators'
import { ApiKeysService } from './api-keys.service'

const uuidParam = new ZodValidationPipe(z.uuid())

/** Admin CRUD for tenant API keys (docs/API_KEYS.md). `integrations.manage`, never `@PublicApi`. */
@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Get()
  @RequirePermission('integrations.manage')
  async list() {
    return { data: await this.apiKeys.list() }
  }

  /** The secret is returned once, here, and never again. */
  @Post()
  @RequirePermission('integrations.manage')
  @HttpCode(201)
  async create(
    @Body(new ZodValidationPipe(createApiKeyRequestSchema))
    body: z.infer<typeof createApiKeyRequestSchema>,
  ) {
    return { data: await this.apiKeys.create(body) }
  }

  @Delete(':id')
  @RequirePermission('integrations.manage')
  @HttpCode(204)
  async revoke(@Param('id', uuidParam) id: string): Promise<void> {
    await this.apiKeys.revoke(id)
  }
}

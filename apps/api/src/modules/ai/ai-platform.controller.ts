import {
  updatePlatformAiSettingsRequestSchema,
  type UpdatePlatformAiSettingsRequest,
} from '@fenwira/contracts'
import { Body, Controller, Get, Param, Patch } from '@nestjs/common'
import { z } from 'zod'
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe'
import { PlatformAccess } from '../../core/security/decorators'
import { AiPlatformService } from './ai-platform.service'

const uuid = new ZodValidationPipe(z.uuid())

/** Operator console: AI Assistant switch and monthly quota per workspace. */
@Controller('platform/workspaces/:workspaceId/ai')
export class AiPlatformController {
  constructor(private readonly ai: AiPlatformService) {}

  @PlatformAccess('commercial.read')
  @Get()
  async get(@Param('workspaceId', uuid) workspaceId: string) {
    return { data: await this.ai.get(workspaceId) }
  }

  @PlatformAccess('workspaces.manage')
  @Patch()
  async update(
    @Param('workspaceId', uuid) workspaceId: string,
    @Body(new ZodValidationPipe(updatePlatformAiSettingsRequestSchema))
    body: UpdatePlatformAiSettingsRequest,
  ) {
    return { data: await this.ai.update(workspaceId, body) }
  }
}

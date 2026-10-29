import {
  aiKnowledgeUploadUrlRequestSchema,
  type AiKnowledgeUploadUrlRequest,
  aiPlaygroundRequestSchema,
  type AiPlaygroundRequest,
  createAiFaqSourceRequestSchema,
  type CreateAiFaqSourceRequest,
  createAiFileSourceRequestSchema,
  type CreateAiFileSourceRequest,
  createAiTextSourceRequestSchema,
  type CreateAiTextSourceRequest,
  replaceAiSourceRequestSchema,
  type ReplaceAiSourceRequest,
  updateAiSettingsRequestSchema,
  type UpdateAiSettingsRequest,
} from '@fenwira/contracts'
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common'
import { z } from 'zod'
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe'
import { RequirePermission } from '../../core/security/decorators'
import { AiService } from './ai.service'

const uuidParam = new ZodValidationPipe(z.uuid())
const limitQuery = new ZodValidationPipe(z.coerce.number().int().min(1).max(200).default(50))

/**
 * AI Assistant (docs/API_SPEC.md → AI Assistant). Reads need `automations.read`, changes
 * `ai.manage`; the activity log (customer excerpts) needs `inbox.read_all`. Turning the managed
 * flow on and off lives with the automation module (AiAssistantFlowController).
 */
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('overview')
  @RequirePermission('automations.read')
  async overview() {
    return { data: await this.ai.overview() }
  }

  @Get('settings')
  @RequirePermission('automations.read')
  async settings() {
    return { data: await this.ai.settings() }
  }

  @Patch('settings')
  @RequirePermission('ai.manage')
  async updateSettings(
    @Body(new ZodValidationPipe(updateAiSettingsRequestSchema)) body: UpdateAiSettingsRequest,
  ) {
    return { data: await this.ai.updateSettings(body) }
  }

  @Get('knowledge')
  @RequirePermission('automations.read')
  async sources() {
    return { data: await this.ai.sources() }
  }

  @Post('knowledge/upload-url')
  @RequirePermission('ai.manage')
  @HttpCode(201)
  async uploadUrl(
    @Body(new ZodValidationPipe(aiKnowledgeUploadUrlRequestSchema))
    body: AiKnowledgeUploadUrlRequest,
  ) {
    return { data: await this.ai.uploadUrl(body) }
  }

  @Post('knowledge/files')
  @RequirePermission('ai.manage')
  @HttpCode(201)
  async addFile(
    @Body(new ZodValidationPipe(createAiFileSourceRequestSchema)) body: CreateAiFileSourceRequest,
  ) {
    return { data: await this.ai.addFile(body) }
  }

  @Post('knowledge/faq')
  @RequirePermission('ai.manage')
  @HttpCode(201)
  async addFaq(
    @Body(new ZodValidationPipe(createAiFaqSourceRequestSchema)) body: CreateAiFaqSourceRequest,
  ) {
    return { data: await this.ai.addFaq(body) }
  }

  @Post('knowledge/text')
  @RequirePermission('ai.manage')
  @HttpCode(201)
  async addText(
    @Body(new ZodValidationPipe(createAiTextSourceRequestSchema)) body: CreateAiTextSourceRequest,
  ) {
    return { data: await this.ai.addText(body) }
  }

  @Get('knowledge/:id')
  @RequirePermission('automations.read')
  async source(@Param('id', uuidParam) id: string) {
    return { data: await this.ai.source(id) }
  }

  @Post('knowledge/:id/replace')
  @RequirePermission('ai.manage')
  async replace(
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(replaceAiSourceRequestSchema)) body: ReplaceAiSourceRequest,
  ) {
    return { data: await this.ai.replace(id, body) }
  }

  @Post('knowledge/:id/reprocess')
  @RequirePermission('ai.manage')
  async reprocess(@Param('id', uuidParam) id: string) {
    return { data: await this.ai.reprocess(id) }
  }

  @Delete('knowledge/:id')
  @RequirePermission('ai.manage')
  @HttpCode(204)
  async remove(@Param('id', uuidParam) id: string): Promise<void> {
    await this.ai.remove(id)
  }

  /** Counts against the monthly quota (unless AI_PLAYGROUND_COUNTS_QUOTA=false); rate-limited. */
  @Post('playground')
  @RequirePermission('ai.manage')
  @HttpCode(200)
  async playground(
    @Body(new ZodValidationPipe(aiPlaygroundRequestSchema)) body: AiPlaygroundRequest,
  ) {
    return { data: await this.ai.playground(body.question) }
  }

  @Get('usage')
  @RequirePermission('automations.read')
  async usage() {
    return { data: await this.ai.usage() }
  }

  @Get('activity')
  @RequirePermission('inbox.read_all')
  async activity(@Query('limit', limitQuery) limit: number) {
    return { data: await this.ai.activity(limit) }
  }
}

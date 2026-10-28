import {
  AI_ACTIVATION_STATUSES,
  approveAiActivationRequestSchema,
  type ApproveAiActivationRequest,
  createAiActivationRequestSchema,
  type CreateAiActivationRequest,
  rejectAiActivationRequestSchema,
  type RejectAiActivationRequest,
  upsertAiPlanSchema,
  type UpsertAiPlan,
} from '@fenwira/contracts'
import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common'
import { z } from 'zod'
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe'
import { PlatformAccess, RequirePermission } from '../../core/security/decorators'
import { AiActivationPlatformService } from './ai-activation-platform.service'
import { AiActivationService } from './ai-activation.service'

const uuid = new ZodValidationPipe(z.uuid())
const statusQuery = new ZodValidationPipe(z.enum(AI_ACTIVATION_STATUSES).optional())

/**
 * AI Assistant activation requests (docs/AI_ASSISTANT.md → Activation requests). Anyone who can
 * see the AI page reads the state; submitting and cancelling need `ai.manage`.
 */
@Controller('ai/activation')
export class AiActivationController {
  constructor(private readonly activation: AiActivationService) {}

  @Get()
  @RequirePermission('automations.read')
  async state() {
    return { data: await this.activation.state() }
  }

  @Post('requests')
  @RequirePermission('ai.manage')
  async request(
    @Body(new ZodValidationPipe(createAiActivationRequestSchema)) body: CreateAiActivationRequest,
  ) {
    return { data: await this.activation.request(body) }
  }

  @Post('requests/:id/cancel')
  @HttpCode(200)
  @RequirePermission('ai.manage')
  async cancel(@Param('id', uuid) id: string) {
    return { data: await this.activation.cancel(id) }
  }
}

/** Operator console: the AI request queue and the AI plans shown to customers. */
@Controller('platform/ai')
export class AiActivationPlatformController {
  constructor(private readonly activation: AiActivationPlatformService) {}

  @PlatformAccess('commercial.read')
  @Get('requests')
  async list(@Query('status', statusQuery) status?: (typeof AI_ACTIVATION_STATUSES)[number]) {
    return { data: await this.activation.list(status ?? null) }
  }

  @PlatformAccess('workspaces.manage')
  @Post('workspaces/:workspaceId/requests/:id/approve')
  @HttpCode(200)
  async approve(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(approveAiActivationRequestSchema)) body: ApproveAiActivationRequest,
  ) {
    return { data: await this.activation.approve(workspaceId, id, body) }
  }

  @PlatformAccess('workspaces.manage')
  @Post('workspaces/:workspaceId/requests/:id/reject')
  @HttpCode(200)
  async reject(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(rejectAiActivationRequestSchema)) body: RejectAiActivationRequest,
  ) {
    return { data: await this.activation.reject(workspaceId, id, body) }
  }

  @PlatformAccess('commercial.read')
  @Get('plans')
  async plans() {
    return { data: await this.activation.plans() }
  }

  @PlatformAccess('workspaces.manage')
  @Post('plans')
  async createPlan(@Body(new ZodValidationPipe(upsertAiPlanSchema)) body: UpsertAiPlan) {
    return { data: await this.activation.createPlan(body) }
  }

  @PlatformAccess('workspaces.manage')
  @Post('plans/:id')
  @HttpCode(200)
  async updatePlan(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(upsertAiPlanSchema)) body: UpsertAiPlan,
  ) {
    return { data: await this.activation.updatePlan(id, body) }
  }
}

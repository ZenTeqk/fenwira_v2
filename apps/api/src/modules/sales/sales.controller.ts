import {
  createFollowUpSchema,
  createOpportunitySchema,
  createSalesStageSchema,
  followUpActionSchema,
  followUpsQuerySchema,
  opportunitiesQuerySchema,
  reassignFollowUpSchema,
  rescheduleFollowUpSchema,
  reorderSalesStagesSchema,
  updateFollowUpSchema,
  updateOpportunitySchema,
  updateSalesStageSchema,
} from '@fenwira/contracts'
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common'
import { z } from 'zod'
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe'
import { RequirePermission } from '../../core/security/decorators'
import { FollowUpsService } from './follow-ups.service'
import { OpportunitiesService } from './opportunities.service'
import { SalesStagesService } from './stages.service'

const uuidParam = new ZodValidationPipe(z.uuid())
const pipe = <T extends z.ZodType>(schema: T) => new ZodValidationPipe(schema)
type In<T extends z.ZodType> = z.infer<T>

/** Settings → Sales → Stages (docs/API_SPEC.md → Sales). */
@Controller('sales/stages')
export class SalesStagesController {
  constructor(private readonly stages: SalesStagesService) {}

  @Get()
  @RequirePermission('sales.read')
  async list() {
    return { data: await this.stages.list() }
  }

  @Post()
  @RequirePermission('sales.stages.manage')
  @HttpCode(201)
  async create(@Body(pipe(createSalesStageSchema)) body: In<typeof createSalesStageSchema>) {
    return { data: await this.stages.create(body) }
  }

  @Put('order')
  @RequirePermission('sales.stages.manage')
  async reorder(@Body(pipe(reorderSalesStagesSchema)) body: In<typeof reorderSalesStagesSchema>) {
    return { data: await this.stages.reorder(body.ids) }
  }

  @Patch(':id')
  @RequirePermission('sales.stages.manage')
  async update(
    @Param('id', uuidParam) id: string,
    @Body(pipe(updateSalesStageSchema)) body: In<typeof updateSalesStageSchema>,
  ) {
    return { data: await this.stages.update(id, body) }
  }
}

@Controller('opportunities')
export class OpportunitiesController {
  constructor(private readonly opportunities: OpportunitiesService) {}

  @Get()
  @RequirePermission('sales.read')
  async list(@Query(pipe(opportunitiesQuerySchema)) q: In<typeof opportunitiesQuerySchema>) {
    const { items, page } = await this.opportunities.list(q)
    return { data: items, page }
  }

  @Get(':id')
  @RequirePermission('sales.read')
  async get(@Param('id', uuidParam) id: string) {
    return { data: await this.opportunities.get(id) }
  }

  @Post()
  @RequirePermission('sales.write')
  @HttpCode(201)
  async create(@Body(pipe(createOpportunitySchema)) body: In<typeof createOpportunitySchema>) {
    return { data: await this.opportunities.create(body) }
  }

  @Patch(':id')
  @RequirePermission('sales.write')
  async update(
    @Param('id', uuidParam) id: string,
    @Body(pipe(updateOpportunitySchema)) body: In<typeof updateOpportunitySchema>,
  ) {
    return { data: await this.opportunities.update(id, body) }
  }
}

@Controller('follow-ups')
export class FollowUpsController {
  constructor(private readonly followUps: FollowUpsService) {}

  @Get()
  @RequirePermission('followups.read')
  async list(@Query(pipe(followUpsQuerySchema)) q: In<typeof followUpsQuerySchema>) {
    const { items, page } = await this.followUps.list(q)
    return { data: items, page }
  }

  /** Tab counts under the same filters as the list. */
  @Get('counts')
  @RequirePermission('followups.read')
  async counts(@Query(pipe(followUpsQuerySchema)) q: In<typeof followUpsQuerySchema>) {
    return { data: await this.followUps.counts(q) }
  }

  /** The current user's overdue / today / needs-review counts (sidebar badge). */
  @Get('summary')
  @RequirePermission('followups.read')
  async summary() {
    return { data: await this.followUps.summary() }
  }

  @Get(':id')
  @RequirePermission('followups.read')
  async get(@Param('id', uuidParam) id: string) {
    return { data: await this.followUps.get(id) }
  }

  @Post()
  @RequirePermission('followups.write')
  @HttpCode(201)
  async create(@Body(pipe(createFollowUpSchema)) body: In<typeof createFollowUpSchema>) {
    return { data: await this.followUps.create(body) }
  }

  @Patch(':id')
  @RequirePermission('followups.write')
  async edit(
    @Param('id', uuidParam) id: string,
    @Body(pipe(updateFollowUpSchema)) body: In<typeof updateFollowUpSchema>,
  ) {
    return { data: await this.followUps.edit(id, body) }
  }

  @Post(':id/complete')
  @RequirePermission('followups.write')
  @HttpCode(200)
  async complete(
    @Param('id', uuidParam) id: string,
    @Body(pipe(followUpActionSchema)) body: In<typeof followUpActionSchema>,
  ) {
    return { data: await this.followUps.complete(id, body.version) }
  }

  @Post(':id/cancel')
  @RequirePermission('followups.write')
  @HttpCode(200)
  async cancel(
    @Param('id', uuidParam) id: string,
    @Body(pipe(followUpActionSchema)) body: In<typeof followUpActionSchema>,
  ) {
    return { data: await this.followUps.cancel(id, body.version) }
  }

  @Post(':id/reviewed')
  @RequirePermission('followups.write')
  @HttpCode(200)
  async reviewed(
    @Param('id', uuidParam) id: string,
    @Body(pipe(followUpActionSchema)) body: In<typeof followUpActionSchema>,
  ) {
    return { data: await this.followUps.reviewed(id, body.version) }
  }

  @Post(':id/reschedule')
  @RequirePermission('followups.write')
  @HttpCode(200)
  async reschedule(
    @Param('id', uuidParam) id: string,
    @Body(pipe(rescheduleFollowUpSchema)) body: In<typeof rescheduleFollowUpSchema>,
  ) {
    return { data: await this.followUps.reschedule(id, body.dueAt, body.version) }
  }

  @Post(':id/reassign')
  @RequirePermission('followups.write')
  @HttpCode(200)
  async reassign(
    @Param('id', uuidParam) id: string,
    @Body(pipe(reassignFollowUpSchema)) body: In<typeof reassignFollowUpSchema>,
  ) {
    return { data: await this.followUps.reassign(id, body.assigneeId, body.version) }
  }
}

import {
  cannedRepliesQuerySchema,
  createCannedReplySchema,
  updateCannedReplySchema,
} from '@fenwira/contracts'
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common'
import { z } from 'zod'
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe'
import { RequirePermission } from '../../core/security/decorators'
import { CannedRepliesService } from './canned-replies.service'

const uuidParam = new ZodValidationPipe(z.uuid())
type In<T extends z.ZodType> = z.infer<T>

/** Using canned replies needs inbox.reply; managing them needs inbox.canned_replies.manage. */
@Controller('canned-replies')
export class CannedRepliesController {
  constructor(private readonly replies: CannedRepliesService) {}

  @Get()
  @RequirePermission('inbox.reply')
  async list(
    @Query(new ZodValidationPipe(cannedRepliesQuerySchema))
    query: In<typeof cannedRepliesQuerySchema>,
  ) {
    return { data: await this.replies.list(query.q) }
  }

  @Post()
  @RequirePermission('inbox.canned_replies.manage')
  async create(
    @Body(new ZodValidationPipe(createCannedReplySchema)) body: In<typeof createCannedReplySchema>,
  ) {
    return { data: await this.replies.create(body) }
  }

  @Patch(':id')
  @RequirePermission('inbox.canned_replies.manage')
  async update(
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(updateCannedReplySchema)) body: In<typeof updateCannedReplySchema>,
  ) {
    return { data: await this.replies.update(id, body) }
  }

  @Delete(':id')
  @RequirePermission('inbox.canned_replies.manage')
  @HttpCode(204)
  async remove(@Param('id', uuidParam) id: string): Promise<void> {
    await this.replies.remove(id)
  }
}

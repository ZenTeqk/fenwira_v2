import {
  type Conversation,
  type FileDto,
  listQuerySchema,
  type Message,
  messagesQuerySchema,
  sendMessageRequestSchema,
  startConversationRequestSchema,
  uploadUrlRequestSchema,
} from '@fenwira/contracts'
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseInterceptors,
} from '@nestjs/common'
import { type Request } from 'express'
import { z } from 'zod'
import { IdempotencyInterceptor } from '../../core/http/idempotency.interceptor'
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe'
import { RequirePermission } from '../../core/security/decorators'
import { currentAuth } from '../identity'
import { currentTenant } from '../tenancy'
import { ConversationsService } from './conversations.service'
import { FilesService } from './files.service'
import { MessagingService } from './messaging.service'

const uuidParam = new ZodValidationPipe(z.uuid())
/** Message-level key: the HTTP key scoped to the route, so two endpoints never collide. */
const messageKey = (req: Request, scope: string) => `http:${scope}:${req.header('idempotency-key')}`

@Controller()
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly messaging: MessagingService,
  ) {}

  @Get('conversations')
  @RequirePermission('inbox.read')
  async list(
    @Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ): Promise<{ data: Conversation[]; page: unknown }> {
    const { items, page } = await this.conversations.list(query)
    return { data: items, page }
  }

  /** Starts (or continues) a conversation with a phone number. Usually a template. */
  @Post('conversations')
  @RequirePermission('inbox.reply')
  @UseInterceptors(IdempotencyInterceptor)
  @HttpCode(201)
  async start(
    @Req() req: Request,
    @Body(new ZodValidationPipe(startConversationRequestSchema))
    body: z.infer<typeof startConversationRequestSchema>,
  ): Promise<{ data: Message }> {
    const message = await this.messaging.send({
      tenantId: currentTenant().tenantId,
      target: { phoneE164: body.to, phoneNumberId: body.phoneNumberId },
      content: body.content,
      source: 'INBOX',
      idempotencyKey: messageKey(req, 'start'),
      actorUserId: currentAuth().userId,
    })
    return { data: message }
  }

  @Get('conversations/:id')
  @RequirePermission('inbox.read')
  async get(@Param('id', uuidParam) id: string): Promise<{ data: Conversation }> {
    return { data: await this.conversations.get(id) }
  }

  @Get('conversations/:id/messages')
  @RequirePermission('inbox.read')
  async messages(
    @Param('id', uuidParam) id: string,
    @Query(new ZodValidationPipe(messagesQuerySchema)) query: z.infer<typeof messagesQuerySchema>,
  ): Promise<{ data: Message[]; page: unknown }> {
    const { items, page } = await this.conversations.messages(id, query)
    return { data: items, page }
  }

  @Post('conversations/:id/messages')
  @RequirePermission('inbox.reply')
  @UseInterceptors(IdempotencyInterceptor)
  @HttpCode(201)
  async send(
    @Req() req: Request,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(sendMessageRequestSchema))
    body: z.infer<typeof sendMessageRequestSchema>,
  ): Promise<{ data: Message }> {
    const message = await this.messaging.send({
      tenantId: currentTenant().tenantId,
      target: { conversationId: id },
      content: body.content,
      source: 'INBOX',
      idempotencyKey: messageKey(req, `conv:${id}`),
      actorUserId: currentAuth().userId,
    })
    return { data: message }
  }

  @Post('conversations/:id/read')
  @RequirePermission('inbox.read')
  @HttpCode(204)
  async read(@Param('id', uuidParam) id: string): Promise<void> {
    await this.conversations.markRead(id)
  }

  @Get('messages/:id')
  @RequirePermission('inbox.read')
  async message(@Param('id', uuidParam) id: string): Promise<{ data: Message }> {
    return { data: await this.conversations.message(id) }
  }
}

@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post('upload-url')
  @RequirePermission('inbox.reply')
  @HttpCode(201)
  async uploadUrl(
    @Body(new ZodValidationPipe(uploadUrlRequestSchema))
    body: z.infer<typeof uploadUrlRequestSchema>,
  ) {
    return { data: await this.files.createUpload(body) }
  }

  @Post(':id/complete')
  @RequirePermission('inbox.reply')
  @HttpCode(200)
  async complete(@Param('id', uuidParam) id: string): Promise<{ data: FileDto }> {
    return { data: await this.files.complete(id) }
  }

  @Get(':id/download-url')
  @RequirePermission('inbox.read')
  async downloadUrl(@Param('id', uuidParam) id: string) {
    return { data: await this.files.downloadUrl(id) }
  }
}

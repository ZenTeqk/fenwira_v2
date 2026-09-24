import {
  assignRequestSchema,
  automationStateRequestSchema,
  composeLockRequestSchema,
  conversationsQuerySchema,
  conversationStatusRequestSchema,
  createConversationNoteSchema,
  inboxSettingsSchema,
  messagesQuerySchema,
  sendMessageRequestSchema,
  startConversationRequestSchema,
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
  Put,
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
import { MessagingService } from '../messaging'
import { currentTenant } from '../tenancy'
import { InboxService } from './inbox.service'
import { PresenceService } from './presence.service'

const uuidParam = new ZodValidationPipe(z.uuid())
const pipe = <T extends z.ZodType>(schema: T) => new ZodValidationPipe(schema)
type In<T extends z.ZodType> = z.infer<T>
/** Message-level key: the HTTP key scoped to the route, so two endpoints never collide. */
const messageKey = (req: Request, scope: string) => `http:${scope}:${req.header('idempotency-key')}`

@Controller()
export class ConversationsController {
  constructor(
    private readonly inbox: InboxService,
    private readonly messaging: MessagingService,
  ) {}

  @Get('conversations')
  @RequirePermission('inbox.read')
  async list(@Query(pipe(conversationsQuerySchema)) query: In<typeof conversationsQuerySchema>) {
    const { items, page } = await this.inbox.list(query)
    return { data: items, page }
  }

  /** Starts (or continues) a conversation with a phone number. Usually a template. */
  @Post('conversations')
  @RequirePermission('inbox.reply')
  @UseInterceptors(IdempotencyInterceptor)
  @HttpCode(201)
  async start(
    @Req() req: Request,
    @Body(pipe(startConversationRequestSchema)) body: In<typeof startConversationRequestSchema>,
  ) {
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
  async get(@Param('id', uuidParam) id: string) {
    return { data: await this.inbox.get(id) }
  }

  @Get('conversations/:id/messages')
  @RequirePermission('inbox.read')
  async messages(
    @Param('id', uuidParam) id: string,
    @Query(pipe(messagesQuerySchema)) query: In<typeof messagesQuerySchema>,
  ) {
    const { items, page } = await this.inbox.thread(id, query)
    return { data: items, page }
  }

  @Post('conversations/:id/messages')
  @RequirePermission('inbox.reply')
  @UseInterceptors(IdempotencyInterceptor)
  @HttpCode(201)
  async reply(
    @Req() req: Request,
    @Param('id', uuidParam) id: string,
    @Body(pipe(sendMessageRequestSchema)) body: In<typeof sendMessageRequestSchema>,
  ) {
    return { data: await this.inbox.reply(id, body.content, messageKey(req, `conv:${id}`)) }
  }

  @Post('conversations/:id/read')
  @RequirePermission('inbox.read')
  @HttpCode(204)
  async read(@Param('id', uuidParam) id: string): Promise<void> {
    await this.inbox.markRead(id)
  }

  /** Self-assign needs inbox.assign_self; anything else inbox.reassign (checked in the service). */
  @Post('conversations/:id/assign')
  @RequirePermission('inbox.assign_self')
  @HttpCode(200)
  async assign(
    @Param('id', uuidParam) id: string,
    @Body(pipe(assignRequestSchema)) body: In<typeof assignRequestSchema>,
  ) {
    return { data: await this.inbox.assign(id, body.assigneeId) }
  }

  @Post('conversations/:id/status')
  @RequirePermission('inbox.reply')
  @HttpCode(200)
  async status(
    @Param('id', uuidParam) id: string,
    @Body(pipe(conversationStatusRequestSchema)) body: In<typeof conversationStatusRequestSchema>,
  ) {
    return { data: await this.inbox.setStatus(id, body.status, body.snoozedUntil) }
  }

  @Post('conversations/:id/automation-state')
  @RequirePermission('inbox.reply')
  @HttpCode(200)
  async automationState(
    @Param('id', uuidParam) id: string,
    @Body(pipe(automationStateRequestSchema)) body: In<typeof automationStateRequestSchema>,
  ) {
    return { data: await this.inbox.setAutomationState(id, body.state) }
  }

  @Get('conversations/:id/compose-lock')
  @RequirePermission('inbox.read')
  async getLock(@Param('id', uuidParam) id: string) {
    return { data: await this.inbox.currentLock(id) }
  }

  @Post('conversations/:id/compose-lock')
  @RequirePermission('inbox.reply')
  @HttpCode(200)
  async lock(
    @Param('id', uuidParam) id: string,
    @Body(pipe(composeLockRequestSchema)) body: In<typeof composeLockRequestSchema>,
  ) {
    return { data: await this.inbox.lock(id, body.force) }
  }

  @Delete('conversations/:id/compose-lock')
  @RequirePermission('inbox.reply')
  @HttpCode(204)
  async unlock(@Param('id', uuidParam) id: string): Promise<void> {
    await this.inbox.unlock(id)
  }

  @Get('conversations/:id/notes')
  @RequirePermission('inbox.read')
  async notes(@Param('id', uuidParam) id: string) {
    return { data: await this.inbox.notes(id) }
  }

  @Post('conversations/:id/notes')
  @RequirePermission('inbox.reply')
  @HttpCode(201)
  async addNote(
    @Param('id', uuidParam) id: string,
    @Body(pipe(createConversationNoteSchema)) body: In<typeof createConversationNoteSchema>,
  ) {
    return { data: await this.inbox.addNote(id, body.body, body.mentions) }
  }

  @Put('conversations/:id/tags/:tagId')
  @RequirePermission('inbox.reply')
  async addTag(@Param('id', uuidParam) id: string, @Param('tagId', uuidParam) tagId: string) {
    return { data: await this.inbox.tag(id, tagId, true) }
  }

  @Delete('conversations/:id/tags/:tagId')
  @RequirePermission('inbox.reply')
  async removeTag(@Param('id', uuidParam) id: string, @Param('tagId', uuidParam) tagId: string) {
    return { data: await this.inbox.tag(id, tagId, false) }
  }

  @Get('messages/:id')
  @RequirePermission('inbox.read')
  async message(@Param('id', uuidParam) id: string) {
    return { data: await this.inbox.message(id) }
  }
}

@Controller()
export class InboxController {
  constructor(
    private readonly inbox: InboxService,
    private readonly presence: PresenceService,
  ) {}

  @Get('inbox/presence')
  @RequirePermission('inbox.read')
  async presenceList() {
    return { data: await this.presence.list(currentTenant().tenantId) }
  }

  @Get('inbox/unread-count')
  @RequirePermission('inbox.read')
  async unread() {
    return { data: { conversations: await this.inbox.unreadConversations() } }
  }

  /** Everyone's own notifications (every role holds workspace.read). */
  @Get('notifications')
  @RequirePermission('workspace.read')
  async notifications() {
    const { items, unread } = await this.inbox.notifications()
    return { data: items, meta: { unread } }
  }

  @Post('notifications/read-all')
  @RequirePermission('workspace.read')
  @HttpCode(204)
  async readAll(): Promise<void> {
    await this.inbox.readNotification('all')
  }

  @Post('notifications/:id/read')
  @RequirePermission('workspace.read')
  @HttpCode(204)
  async readOne(@Param('id', uuidParam) id: string): Promise<void> {
    await this.inbox.readNotification(id)
  }

  @Get('workspace/inbox-settings')
  @RequirePermission('workspace.read')
  async settings() {
    return { data: await this.inbox.settings() }
  }

  @Patch('workspace/inbox-settings')
  @RequirePermission('workspace.manage')
  async updateSettings(
    @Body(pipe(inboxSettingsSchema.partial())) body: Partial<In<typeof inboxSettingsSchema>>,
  ) {
    return { data: await this.inbox.updateSettings(body) }
  }
}

import {
  type GraphSendResponse,
  graphSendRequestSchema,
  type GraphSendRequest,
} from '@fenwira/contracts'
import { uuidv7 } from '@fenwira/config'
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { type Request } from 'express'
import { TenantDb } from '../../core/database/tenant-db'
import { AppError } from '../../core/http/app-error'
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe'
import { PublicApi, RequirePermission } from '../../core/security/decorators'
import { currentApiKey, currentAuth } from '../identity'
import { currentTenant } from '../tenancy'
import { FilesService } from './files.service'
import { graphSendToContent } from './graph-compat'
import { MessagingService } from './messaging.service'

/** Large enough for any invoice or quotation PDF, small enough to buffer in memory. */
const GRAPH_MEDIA_MAX_BYTES = 16 * 1024 * 1024
const KEY_RE = /^[\x21-\x7e]{8,128}$/

type Upload = { buffer: Buffer; mimetype: string; originalname: string; size: number }

/**
 * Meta-compatible send (docs/API_KEYS.md → Meta-compatible send): the Cloud API's
 * `/{phone-number-id}`, `/media` and `/messages` under `/api/v1/graph`, so an integration built for
 * Meta switches to Fenwira by changing its base URL and token. Sends go through MessagingService
 * (source `API`) with every check an ordinary send has, and appear in the Inbox. `:phoneNumberId`
 * is Meta's phone number id of a number connected to this workspace, or `default`.
 */
@Controller('graph')
export class GraphController {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly files: FilesService,
    private readonly messaging: MessagingService,
  ) {}

  /** Meta's phone-number lookup, used by integrations as a connection test. */
  @Get(':phoneNumberId')
  @RequirePermission('inbox.reply')
  @PublicApi()
  async phone(@Param('phoneNumberId') phoneNumberId: string) {
    const phone = await this.resolvePhone(phoneNumberId)
    return {
      id: phone.phoneNumberId,
      display_phone_number: phone.displayPhoneNumber,
      verified_name: phone.verifiedName,
    }
  }

  @Post(':phoneNumberId/media')
  @RequirePermission('inbox.reply')
  @PublicApi()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: GRAPH_MEDIA_MAX_BYTES } }))
  @HttpCode(200)
  async media(
    @Param('phoneNumberId') phoneNumberId: string,
    @UploadedFile() file: Upload | undefined,
    @Body() body: { type?: string },
  ) {
    await this.resolvePhone(phoneNumberId)
    if (!file)
      throw AppError.validation([
        { path: 'file', code: 'required', message: 'Send the file as multipart field `file`.' },
      ])
    const stored = await this.files.store({
      bytes: file.buffer,
      mimeType: (body.type || file.mimetype).split(';')[0]!.trim().toLowerCase(),
      filename: file.originalname || undefined,
    })
    return { id: stored.id }
  }

  @Post(':phoneNumberId/messages')
  @RequirePermission('inbox.reply')
  @PublicApi()
  @HttpCode(200)
  async send(
    @Req() req: Request,
    @Param('phoneNumberId') phoneNumberId: string,
    @Body(new ZodValidationPipe(graphSendRequestSchema)) body: GraphSendRequest,
  ): Promise<GraphSendResponse> {
    const phone = await this.resolvePhone(phoneNumberId)
    // Meta has no Idempotency-Key, so it's optional here; with one, a retry never sends twice.
    const key = req.header('idempotency-key')
    if (key !== undefined && !KEY_RE.test(key))
      throw AppError.validation([
        { path: 'Idempotency-Key', code: 'invalid', message: 'Use 8–128 printable characters.' },
      ])
    const apiKey = currentApiKey()
    const message = await this.messaging.send({
      tenantId: currentTenant().tenantId,
      target: { phoneE164: `+${body.to}`, phoneNumberId: phone.id },
      content: graphSendToContent(body),
      source: apiKey ? 'API' : 'INBOX',
      idempotencyKey: key ? `http:graph:${key}` : `graph:${uuidv7()}`,
      actorUserId: apiKey ? undefined : currentAuth().userId,
    })
    return {
      messaging_product: 'whatsapp',
      contacts: [{ input: body.to, wa_id: body.to }],
      messages: [{ id: message.id, message_status: 'accepted' }],
    }
  }

  private async resolvePhone(phoneNumberId: string) {
    const phone = await this.tenantDb.run((tx) =>
      tx.whatsAppPhoneNumber.findFirst({
        where: {
          status: { not: 'DISCONNECTED' },
          ...(phoneNumberId === 'default' ? {} : { phoneNumberId }),
        },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      }),
    )
    if (!phone) throw AppError.notFound("This WhatsApp number isn't connected to this workspace.")
    return phone
  }
}

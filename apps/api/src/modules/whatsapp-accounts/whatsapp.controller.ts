import {
  connectWhatsAppRequestSchema,
  devConnectWhatsAppRequestSchema,
  rotateTokenRequestSchema,
  type TestConnectionResult,
  updateConnectionRequestSchema,
  type WhatsAppConnection,
  type WhatsAppSignupConfig,
} from '@fenwira/contracts'
import {
  Body,
  type CanActivate,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common'
import { z } from 'zod'
import { AppError } from '../../core/http/app-error'
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe'
import { RequirePermission } from '../../core/security/decorators'
import { WhatsAppConnectionService } from './connection.service'
import { WHATSAPP_OPTIONS, type WhatsAppOptions } from './whatsapp.options'

const uuidParam = new ZodValidationPipe(z.uuid())

/**
 * ADR-0027 Managed Launch Mode: Embedded Signup and tenant-side changes to the Meta connection
 * (connect, retry, sync, token rotation, disconnect) don't exist (404, before body validation);
 * platform operators make them from /platform. Listing, renaming, the default number and test
 * sends stay available.
 */
@Injectable()
export class SelfServeConnectionGuard implements CanActivate {
  constructor(@Inject(WHATSAPP_OPTIONS) private readonly options: WhatsAppOptions) {}
  canActivate(): boolean {
    if (this.options.managedLaunch) throw AppError.notFound()
    return true
  }
}

@Controller()
export class WhatsAppConnectionsController {
  constructor(private readonly connections: WhatsAppConnectionService) {}

  /** Public Embedded Signup values for the FB JS SDK (never the app secret). */
  @Get('config/whatsapp-signup')
  @UseGuards(SelfServeConnectionGuard)
  @RequirePermission('whatsapp.manage')
  signupConfig(): { data: WhatsAppSignupConfig } {
    return { data: this.connections.signupConfig() }
  }

  @Get('whatsapp/connections')
  @RequirePermission('whatsapp.read')
  async list(): Promise<{ data: WhatsAppConnection[] }> {
    return { data: await this.connections.list() }
  }

  @Post('whatsapp/connections')
  @UseGuards(SelfServeConnectionGuard)
  @RequirePermission('whatsapp.manage')
  @HttpCode(201)
  async connect(
    @Body(new ZodValidationPipe(connectWhatsAppRequestSchema))
    body: z.infer<typeof connectWhatsAppRequestSchema>,
  ): Promise<{ data: WhatsAppConnection }> {
    return { data: await this.connections.connect(body) }
  }

  /** Only when WHATSAPP_DEV_CONNECT=true (404 otherwise). */
  @Post('whatsapp/connections/dev')
  @UseGuards(SelfServeConnectionGuard)
  @RequirePermission('whatsapp.manage')
  @HttpCode(201)
  async devConnect(
    @Body(new ZodValidationPipe(devConnectWhatsAppRequestSchema))
    body: z.infer<typeof devConnectWhatsAppRequestSchema>,
  ): Promise<{ data: WhatsAppConnection }> {
    return { data: await this.connections.devConnect(body) }
  }

  @Post('whatsapp/connections/:id/retry')
  @UseGuards(SelfServeConnectionGuard)
  @RequirePermission('whatsapp.manage')
  @HttpCode(200)
  async retry(@Param('id', uuidParam) id: string): Promise<{ data: WhatsAppConnection }> {
    return { data: await this.connections.retry(id) }
  }

  @Post('whatsapp/connections/:id/test')
  @RequirePermission('whatsapp.manage')
  @HttpCode(200)
  async test(@Param('id', uuidParam) id: string): Promise<{ data: TestConnectionResult }> {
    return { data: await this.connections.test(id) }
  }

  @Post('whatsapp/connections/:id/sync')
  @UseGuards(SelfServeConnectionGuard)
  @RequirePermission('whatsapp.manage')
  @HttpCode(200)
  async sync(@Param('id', uuidParam) id: string): Promise<{ data: WhatsAppConnection }> {
    return { data: await this.connections.sync(id) }
  }

  @Post('whatsapp/connections/:id/rotate-token')
  @UseGuards(SelfServeConnectionGuard)
  @RequirePermission('whatsapp.manage')
  @HttpCode(200)
  async rotate(
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(rotateTokenRequestSchema))
    body: z.infer<typeof rotateTokenRequestSchema>,
  ): Promise<{ data: WhatsAppConnection }> {
    return { data: await this.connections.rotateToken(id, body) }
  }

  @Patch('whatsapp/connections/:id')
  @RequirePermission('whatsapp.manage')
  async update(
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(updateConnectionRequestSchema))
    body: z.infer<typeof updateConnectionRequestSchema>,
  ): Promise<{ data: WhatsAppConnection }> {
    return { data: await this.connections.update(id, body) }
  }

  @Delete('whatsapp/connections/:id')
  @UseGuards(SelfServeConnectionGuard)
  @RequirePermission('whatsapp.manage')
  @HttpCode(204)
  async disconnect(@Param('id', uuidParam) id: string): Promise<void> {
    await this.connections.disconnect(id)
  }
}

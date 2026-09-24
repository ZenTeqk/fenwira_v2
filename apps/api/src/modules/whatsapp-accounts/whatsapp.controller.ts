import {
  connectWhatsAppRequestSchema,
  devConnectWhatsAppRequestSchema,
  rotateTokenRequestSchema,
  type TestConnectionResult,
  testConnectionRequestSchema,
  updateConnectionRequestSchema,
  type WhatsAppConnection,
  type WhatsAppSignupConfig,
} from '@fenwira/contracts'
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common'
import { z } from 'zod'
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe'
import { RequirePermission } from '../../core/security/decorators'
import { WhatsAppConnectionService } from './connection.service'

const uuidParam = new ZodValidationPipe(z.uuid())

@Controller()
export class WhatsAppConnectionsController {
  constructor(private readonly connections: WhatsAppConnectionService) {}

  /** Public Embedded Signup values for the FB JS SDK (never the app secret). */
  @Get('config/whatsapp-signup')
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
  @RequirePermission('whatsapp.manage')
  @HttpCode(201)
  async devConnect(
    @Body(new ZodValidationPipe(devConnectWhatsAppRequestSchema))
    body: z.infer<typeof devConnectWhatsAppRequestSchema>,
  ): Promise<{ data: WhatsAppConnection }> {
    return { data: await this.connections.devConnect(body) }
  }

  @Post('whatsapp/connections/:id/retry')
  @RequirePermission('whatsapp.manage')
  @HttpCode(200)
  async retry(@Param('id', uuidParam) id: string): Promise<{ data: WhatsAppConnection }> {
    return { data: await this.connections.retry(id) }
  }

  @Post('whatsapp/connections/:id/test')
  @RequirePermission('whatsapp.manage')
  @HttpCode(200)
  async test(
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(testConnectionRequestSchema))
    body: z.infer<typeof testConnectionRequestSchema>,
  ): Promise<{ data: TestConnectionResult }> {
    return { data: await this.connections.test(id, body.to) }
  }

  @Post('whatsapp/connections/:id/sync')
  @RequirePermission('whatsapp.manage')
  @HttpCode(200)
  async sync(@Param('id', uuidParam) id: string): Promise<{ data: WhatsAppConnection }> {
    return { data: await this.connections.sync(id) }
  }

  @Post('whatsapp/connections/:id/rotate-token')
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
  @RequirePermission('whatsapp.manage')
  @HttpCode(204)
  async disconnect(@Param('id', uuidParam) id: string): Promise<void> {
    await this.connections.disconnect(id)
  }
}

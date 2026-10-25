import {
  managedConnectRequestSchema,
  managedRotateRequestSchema,
  type ManagedConnectRequest,
  type ManagedRotateRequest,
} from '@fenwira/contracts'
import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common'
import { z } from 'zod'
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe'
import { PlatformAccess } from '../../core/security/decorators'
import { PlatformWhatsAppService } from './platform-whatsapp.service'

const uuid = new ZodValidationPipe(z.uuid())

/** ADR-0027: operator-managed WhatsApp connections (docs/API_SPEC.md → Platform WhatsApp). */
@Controller('platform/workspaces/:workspaceId/whatsapp')
export class PlatformWhatsAppController {
  constructor(private readonly service: PlatformWhatsAppService) {}

  @PlatformAccess('whatsapp.read')
  @Get('connections')
  async list(@Param('workspaceId', uuid) workspaceId: string) {
    return { data: await this.service.list(workspaceId) }
  }

  @PlatformAccess('whatsapp.read')
  @Get('connections/:id')
  async get(@Param('workspaceId', uuid) workspaceId: string, @Param('id', uuid) id: string) {
    return { data: await this.service.get(workspaceId, id) }
  }

  @PlatformAccess('whatsapp.read')
  @Get('connections/:id/health')
  async health(@Param('workspaceId', uuid) workspaceId: string, @Param('id', uuid) id: string) {
    return { data: await this.service.health(workspaceId, id) }
  }

  @PlatformAccess('whatsapp.manage')
  @Post('connections')
  @HttpCode(201)
  async connect(
    @Param('workspaceId', uuid) workspaceId: string,
    @Body(new ZodValidationPipe(managedConnectRequestSchema)) body: ManagedConnectRequest,
  ) {
    return { data: await this.service.connect(workspaceId, body) }
  }

  @PlatformAccess('whatsapp.manage')
  @Post('connections/:id/verify')
  @HttpCode(200)
  async verify(@Param('workspaceId', uuid) workspaceId: string, @Param('id', uuid) id: string) {
    return { data: await this.service.verify(workspaceId, id) }
  }

  @PlatformAccess('whatsapp.manage')
  @Post('connections/:id/subscribe')
  @HttpCode(200)
  async subscribe(@Param('workspaceId', uuid) workspaceId: string, @Param('id', uuid) id: string) {
    return { data: await this.service.subscribe(workspaceId, id) }
  }

  @PlatformAccess('whatsapp.manage')
  @Post('connections/:id/sync')
  @HttpCode(200)
  async sync(@Param('workspaceId', uuid) workspaceId: string, @Param('id', uuid) id: string) {
    return { data: await this.service.syncPhone(workspaceId, id) }
  }

  @PlatformAccess('whatsapp.manage')
  @Post('connections/:id/sync-templates')
  @HttpCode(200)
  async syncTemplates(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('id', uuid) id: string,
  ) {
    return { data: await this.service.syncTemplates(workspaceId, id) }
  }

  @PlatformAccess('whatsapp.manage')
  @Post('connections/:id/rotate')
  @HttpCode(200)
  async rotate(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(managedRotateRequestSchema)) body: ManagedRotateRequest,
  ) {
    return { data: await this.service.rotate(workspaceId, id, body) }
  }

  @PlatformAccess('whatsapp.manage')
  @Delete('connections/:id')
  @HttpCode(204)
  async disconnect(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('id', uuid) id: string,
  ): Promise<void> {
    await this.service.disconnect(workspaceId, id)
  }
}

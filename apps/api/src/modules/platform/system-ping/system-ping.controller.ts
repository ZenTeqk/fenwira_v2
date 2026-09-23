import { type SystemPingAccepted, type SystemPingStatus } from '@fenwira/contracts'
import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common'
import { z } from 'zod'
import { ZodValidationPipe } from '../../../core/http/zod-validation.pipe'
import { SystemPingService } from './system-ping.service'

/**
 * End-to-end probe: api → outbox → relay → queue → worker. Registered only when
 * SYSTEM_PING_ENABLED=true (dev/test); unauthenticated, so never enabled in production.
 */
@Controller('system/ping')
export class SystemPingController {
  constructor(private readonly pings: SystemPingService) {}

  @Post()
  @HttpCode(202)
  request(): Promise<SystemPingAccepted> {
    return this.pings.request()
  }

  @Get(':eventId')
  status(
    @Param('eventId', new ZodValidationPipe(z.uuid())) eventId: string,
  ): Promise<SystemPingStatus> {
    return this.pings.status(eventId)
  }
}

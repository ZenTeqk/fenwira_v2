import { type DynamicModule, Module } from '@nestjs/common'
import {
  OUTBOX_RELAY_OPTIONS,
  type OutboxRelayOptions,
  OutboxRelayService,
} from './outbox/outbox-relay.service'
import { OutboxRelayHealthIndicator } from './outbox/outbox-relay.health'
import { SystemPingProcessor } from './system-ping/system-ping.processor'

/** Worker-side platform: outbox relay + platform processors. */
@Module({})
export class PlatformWorkerModule {
  static forRoot(relay: OutboxRelayOptions): DynamicModule {
    return {
      module: PlatformWorkerModule,
      providers: [
        { provide: OUTBOX_RELAY_OPTIONS, useValue: relay },
        OutboxRelayService,
        OutboxRelayHealthIndicator,
        SystemPingProcessor,
      ],
      exports: [OutboxRelayService, OutboxRelayHealthIndicator, SystemPingProcessor],
    }
  }
}

export const PLATFORM_PROCESSORS = [SystemPingProcessor]

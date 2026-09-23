import { type DynamicModule, Module } from '@nestjs/common'
import { SystemPingController } from './system-ping/system-ping.controller'
import { SystemPingService } from './system-ping/system-ping.service'

@Module({})
export class PlatformApiModule {
  static forRoot(options: { systemPingEnabled: boolean }): DynamicModule {
    return {
      module: PlatformApiModule,
      controllers: options.systemPingEnabled ? [SystemPingController] : [],
      providers: [SystemPingService],
    }
  }
}

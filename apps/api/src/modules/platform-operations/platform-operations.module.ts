import { type DynamicModule, Module } from '@nestjs/common'
import { EntitlementsModule } from '../entitlements'
import { CommercialReadController } from './commercial-read.controller'
import { CommercialReadService } from './commercial-read.service'
import { PlatformAuthController } from './platform-auth.controller'
import { PlatformAuthService } from './platform-auth.service'
import { PlatformGuard } from './platform.guard'
@Module({})
export class PlatformOperationsModule {
  static forApi(identity: DynamicModule): DynamicModule {
    return {
      module: PlatformOperationsModule,
      imports: [identity, EntitlementsModule.forRoot()],
      controllers: [PlatformAuthController, CommercialReadController],
      providers: [PlatformAuthService, PlatformGuard, CommercialReadService],
      exports: [PlatformGuard, PlatformAuthService],
    }
  }
}

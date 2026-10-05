import { type DynamicModule, Module } from '@nestjs/common'
import { PlatformAuthController } from './platform-auth.controller'
import { PlatformAuthService } from './platform-auth.service'
import { PlatformGuard } from './platform.guard'
@Module({})
export class PlatformOperationsModule {
  static forApi(identity: DynamicModule): DynamicModule {
    return {
      module: PlatformOperationsModule,
      imports: [identity],
      controllers: [PlatformAuthController],
      providers: [PlatformAuthService, PlatformGuard],
      exports: [PlatformGuard, PlatformAuthService],
    }
  }
}

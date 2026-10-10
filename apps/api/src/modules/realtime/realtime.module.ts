import { type DynamicModule, Module } from '@nestjs/common'
import { RealtimeGateway } from './realtime.gateway'

@Module({})
export class RealtimeModule {
  /** `imports` must provide JwtService, SessionService (identity) and TenantAccessService (tenancy). */
  static forApi(imports: DynamicModule[]): DynamicModule {
    return {
      module: RealtimeModule,
      imports,
      providers: [RealtimeGateway],
      exports: [RealtimeGateway],
    }
  }
}

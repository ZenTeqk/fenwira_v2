import { type DynamicModule, Module } from '@nestjs/common'
import { AuditModule } from '../audit'
import { EntitlementsModule } from '../entitlements'
import { ApiKeyGuard } from './api-key.guard'
import { ApiKeysController } from './api-keys.controller'
import { API_KEYS_OPTIONS, type ApiKeysOptions } from './api-keys.options'
import { ApiKeysService } from './api-keys.service'

/**
 * API keys (Phase 11 Step 3, docs/API_KEYS.md): the admin CRUD surface (`integrations.manage`)
 * and `ApiKeyGuard`, which authenticates the public API itself. `ApiKeyGuard` is exported so
 * `ApiModule` can register it as the first `APP_GUARD`, ahead of the cookie-session guards.
 */
@Module({})
export class ApiKeysModule {
  static forApi(options: ApiKeysOptions): DynamicModule {
    return {
      module: ApiKeysModule,
      imports: [AuditModule, EntitlementsModule.forRoot()],
      controllers: [ApiKeysController],
      providers: [{ provide: API_KEYS_OPTIONS, useValue: options }, ApiKeysService, ApiKeyGuard],
      exports: [ApiKeyGuard],
    }
  }
}

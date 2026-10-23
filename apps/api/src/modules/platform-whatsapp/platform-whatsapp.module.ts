import { type DynamicModule, Module } from '@nestjs/common'
import { PlatformWhatsAppController } from './platform-whatsapp.controller'
import { PlatformWhatsAppService } from './platform-whatsapp.service'

/**
 * ADR-0027: the operator console's WhatsApp actions. Composes the WhatsApp accounts and templates
 * modules (passed in so their configured instances are shared) without either depending on it.
 */
@Module({})
export class PlatformWhatsAppModule {
  static forApi(imports: DynamicModule[]): DynamicModule {
    return {
      module: PlatformWhatsAppModule,
      imports,
      controllers: [PlatformWhatsAppController],
      providers: [PlatformWhatsAppService],
    }
  }
}

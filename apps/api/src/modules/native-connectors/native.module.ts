import { Module, type DynamicModule } from '@nestjs/common'
import { ContactsModule } from '../contacts'
import { AuditModule } from '../audit'
import { NativeService } from './native.service'
import { NativeController } from './native.controller'
import { NativeProcessor } from './native.processor'
import { NATIVE_OPTIONS, type NativeOptions } from './native.options'
@Module({})
export class NativeModule {
  static forApi(options: NativeOptions): DynamicModule {
    return {
      module: NativeModule,
      imports: [AuditModule, ContactsModule.forApi()],
      controllers: [NativeController],
      providers: [{ provide: NATIVE_OPTIONS, useValue: options }, NativeService],
    }
  }
  static forWorker(options: NativeOptions): DynamicModule {
    return {
      module: NativeModule,
      imports: [AuditModule, ContactsModule.forNative()],
      providers: [{ provide: NATIVE_OPTIONS, useValue: options }, NativeService, NativeProcessor],
      exports: [NativeProcessor],
    }
  }
}

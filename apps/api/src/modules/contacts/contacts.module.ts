import { type DynamicModule, Module } from '@nestjs/common'
import { EntitlementsModule } from '../entitlements'
import { ContactCatalogService } from './catalog.service'
import {
  ContactCatalogController,
  ContactsController,
  ImportExportController,
} from './contacts.controller'
import { ContactsEventsProcessor } from './contacts-events.processor'
import { ContactsService } from './contacts.service'
import { ExportProcessor, ExportsService } from './exports'
import { ImportProcessor } from './imports/import.processor'
import { ImportsService } from './imports/imports.service'

export const CONTACTS_PROCESSORS = [ContactsEventsProcessor, ImportProcessor, ExportProcessor]

@Module({})
export class ContactsModule {
  static forApi(): DynamicModule {
    return {
      module: ContactsModule,
      imports: [EntitlementsModule.forRoot()],
      controllers: [ContactsController, ContactCatalogController, ImportExportController],
      providers: [ContactsService, ContactCatalogService, ImportsService, ExportsService],
    }
  }

  /** Worker side. `imports` must provide MessagingService (opt-out confirmation replies). */
  static forWorker(imports: DynamicModule[]): DynamicModule {
    return {
      module: ContactsModule,
      imports,
      providers: CONTACTS_PROCESSORS,
      exports: CONTACTS_PROCESSORS,
    }
  }
}

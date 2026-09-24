import { type DynamicModule, Global, Module } from '@nestjs/common'
import { MAILER_OPTIONS, Mailer, type MailerOptions } from './mailer'

/** One SMTP transport per worker process, shared by every module that sends email. */
@Global()
@Module({})
export class EmailModule {
  static forRoot(options: MailerOptions): DynamicModule {
    return {
      module: EmailModule,
      providers: [{ provide: MAILER_OPTIONS, useValue: options }, Mailer],
      exports: [Mailer],
    }
  }
}

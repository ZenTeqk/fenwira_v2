import { type DynamicModule, Global, Module } from '@nestjs/common'
import { MAILER_OPTIONS, Mailer, type MailerOptions } from './mailer'
import { OPS_ALERT_OPTIONS, OpsAlerts, type OpsAlertOptions } from './ops-alerts'

/**
 * One SMTP transport per worker process, shared by every module that sends email, and the
 * operational alert channel (decision O1).
 */
@Global()
@Module({})
export class EmailModule {
  static forRoot(options: MailerOptions & { opsAlerts?: OpsAlertOptions }): DynamicModule {
    return {
      module: EmailModule,
      providers: [
        { provide: MAILER_OPTIONS, useValue: options },
        {
          provide: OPS_ALERT_OPTIONS,
          useValue: options.opsAlerts ?? { environment: 'development' },
        },
        Mailer,
        OpsAlerts,
      ],
      exports: [Mailer, OpsAlerts],
    }
  }
}

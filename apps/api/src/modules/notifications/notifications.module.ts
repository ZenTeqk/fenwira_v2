import { type DynamicModule, Module } from '@nestjs/common'
import { BILLING_OPTIONS, type BillingOptions } from '../billing'
import { NotificationsDispatchProcessor } from './notifications-dispatch.processor'
import { NOTIFICATIONS_OPTIONS, type NotificationsOptions } from './notifications.options'

/** Worker side of notifications: the notifications.dispatch consumer (Phase 11). */
@Module({})
export class NotificationsModule {
  static forWorker(options: NotificationsOptions & { billing: BillingOptions }): DynamicModule {
    return {
      module: NotificationsModule,
      providers: [
        { provide: NOTIFICATIONS_OPTIONS, useValue: { webOrigin: options.webOrigin } },
        { provide: BILLING_OPTIONS, useValue: options.billing },
        NotificationsDispatchProcessor,
      ],
      exports: [NotificationsDispatchProcessor],
    }
  }
}

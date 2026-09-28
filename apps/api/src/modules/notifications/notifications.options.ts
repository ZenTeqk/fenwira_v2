import { type BillingSupport } from '../billing'

export type NotificationsOptions = { webOrigin: string; support?: BillingSupport }
export const NOTIFICATIONS_OPTIONS = Symbol('NOTIFICATIONS_OPTIONS')

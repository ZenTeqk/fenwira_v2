import { type KeyRing, type ApiEnv } from '@fenwira/config'
import { type NativeApps } from './native.providers'
export const NATIVE_OPTIONS = Symbol('NATIVE_OPTIONS')
export type NativeOptions = { keyRing: KeyRing; apps: NativeApps; webOrigin: string }
export function nativeOptions(
  env: Pick<
    ApiEnv,
    | 'NATIVE_GOOGLE_CLIENT_ID'
    | 'NATIVE_GOOGLE_CLIENT_SECRET'
    | 'NATIVE_ZOHO_CLIENT_ID'
    | 'NATIVE_ZOHO_CLIENT_SECRET'
    | 'NATIVE_SHOPIFY_CLIENT_ID'
    | 'NATIVE_SHOPIFY_CLIENT_SECRET'
    | 'WEB_ORIGIN'
  >,
  keyRing: KeyRing,
): NativeOptions {
  const apps: NativeApps = {}
  if (env.NATIVE_GOOGLE_CLIENT_ID && env.NATIVE_GOOGLE_CLIENT_SECRET)
    apps.GOOGLE_SHEETS = {
      clientId: env.NATIVE_GOOGLE_CLIENT_ID,
      clientSecret: env.NATIVE_GOOGLE_CLIENT_SECRET,
    }
  if (env.NATIVE_ZOHO_CLIENT_ID && env.NATIVE_ZOHO_CLIENT_SECRET)
    apps.ZOHO_CRM = {
      clientId: env.NATIVE_ZOHO_CLIENT_ID,
      clientSecret: env.NATIVE_ZOHO_CLIENT_SECRET,
    }
  if (env.NATIVE_SHOPIFY_CLIENT_ID && env.NATIVE_SHOPIFY_CLIENT_SECRET)
    apps.SHOPIFY = {
      clientId: env.NATIVE_SHOPIFY_CLIENT_ID,
      clientSecret: env.NATIVE_SHOPIFY_CLIENT_SECRET,
    }
  return { apps, keyRing, webOrigin: env.WEB_ORIGIN }
}

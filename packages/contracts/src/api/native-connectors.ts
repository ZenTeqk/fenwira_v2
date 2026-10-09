import { z } from 'zod'

export const nativeProviderSchema = z.enum(['ERPNEXT', 'GOOGLE_SHEETS', 'ZOHO_CRM', 'SHOPIFY'])
export type NativeProvider = z.infer<typeof nativeProviderSchema>
export const nativeSetupSchema = z
  .object({
    provider: nativeProviderSchema,
    label: z.string().trim().min(1).max(80),
    site: z.string().trim().min(1).max(250).optional(),
    region: z.enum(['com', 'in', 'eu', 'com.au', 'jp', 'ca', 'com.cn', 'sa']).default('com'),
    apiKey: z.string().min(1).max(512).optional(),
    apiSecret: z.string().min(1).max(512).optional(),
  })
  .strict()
export type NativeSetup = z.infer<typeof nativeSetupSchema>
export const nativeCallbackSchema = z
  .object({
    state: z.string().min(32).max(128),
    code: z.string().min(1).max(4096),
    shop: z.string().max(250).optional(),
    hmac: z.string().max(128).optional(),
    timestamp: z.string().max(32).optional(),
    host: z.string().max(512).optional(),
  })
  .strict()
export type NativeCallback = z.infer<typeof nativeCallbackSchema>
export const nativeTransferSchema = z
  .object({
    idempotencyKey: z.uuid(),
    spreadsheetId: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{20,150}$/)
      .optional(),
    confirmExport: z.literal(true).optional(),
  })
  .strict()
export type NativeTransferRequest = z.infer<typeof nativeTransferSchema>
export type NativeConnection = {
  id: string
  provider: NativeProvider
  label: string
  site: string | null
  status: 'ACTIVE' | 'DISCONNECTED'
  createdAt: string
}
export type NativeConnectorCatalog = {
  provider: NativeProvider
  available: boolean
  connections: NativeConnection[]
}
export type NativeTransfer = {
  id: string
  connectionId: string
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED'
  rows: number
  importJobId: string | null
  errorCode: string | null
  createdAt: string
}

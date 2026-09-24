import { z } from 'zod'
import { idSchema } from './common'

/**
 * WhatsApp connections (docs/API_SPEC.md → WhatsApp accounts, docs/META_INTEGRATION.md).
 * No schema here ever carries a token: credentials appear only as `maskedToken` (`EAAG…9f2c`).
 */
const metaIdSchema = z
  .string()
  .trim()
  .regex(/^\d{5,20}$/, 'Use the numeric ID from Meta.')

export const CONNECTION_STEP_KEYS = [
  'EXCHANGE',
  'VERIFY',
  'FETCH',
  'UNIQUE',
  'STORE',
  'SUBSCRIBE',
  'REGISTER',
  'VALIDATE',
] as const
export const connectionStepKeySchema = z.enum(CONNECTION_STEP_KEYS)
export type ConnectionStepKey = z.infer<typeof connectionStepKeySchema>

export const CONNECTION_STEP_STATUSES = ['PENDING', 'DONE', 'FAILED', 'SKIPPED'] as const
export const connectionStepSchema = z.object({
  key: connectionStepKeySchema,
  status: z.enum(CONNECTION_STEP_STATUSES),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
})
export type ConnectionStep = z.infer<typeof connectionStepSchema>

export const PHONE_STATUSES = [
  'PENDING',
  'CONNECTED',
  'FLAGGED',
  'RESTRICTED',
  'DISCONNECTED',
  'ERROR',
] as const
export type PhoneStatus = (typeof PHONE_STATUSES)[number]
export const QUALITY_RATINGS = ['GREEN', 'YELLOW', 'RED', 'UNKNOWN'] as const
export type QualityRating = (typeof QUALITY_RATINGS)[number]
export const CREDENTIAL_STATUSES = ['VALID', 'EXPIRING', 'INVALID', 'REVOKED'] as const
export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[number]
export const WEBHOOK_STATUSES = ['ACTIVE', 'FAILED', 'REMOVED'] as const

export const whatsappConnectionSchema = z.object({
  id: idSchema,
  phoneNumberId: z.string(),
  displayPhoneNumber: z.string(),
  verifiedName: z.string(),
  label: z.string().nullable(),
  waba: z.object({ id: z.string(), name: z.string() }),
  status: z.enum(PHONE_STATUSES),
  qualityRating: z.enum(QUALITY_RATINGS),
  messagingLimitTier: z.string().nullable(),
  throughputMps: z.number().int(),
  isDefault: z.boolean(),
  webhookStatus: z.enum(WEBHOOK_STATUSES).nullable(),
  credential: z
    .object({
      status: z.enum(CREDENTIAL_STATUSES),
      tokenType: z.enum(['BUSINESS_INTEGRATION', 'SYSTEM_USER', 'DEV']),
      maskedToken: z.string(),
      expiresAt: z.string().nullable(),
    })
    .nullable(),
  steps: z.array(connectionStepSchema),
  lastSyncedAt: z.string().nullable(),
  connectedAt: z.string().nullable(),
  createdAt: z.string(),
})
export type WhatsAppConnection = z.infer<typeof whatsappConnectionSchema>

/** Embedded Signup result: the code from FB.login plus the IDs from the WA_EMBEDDED_SIGNUP message. */
export const connectWhatsAppRequestSchema = z.object({
  code: z.string().trim().min(1).max(2048),
  wabaId: metaIdSchema,
  phoneNumberId: metaIdSchema,
})
export type ConnectWhatsAppRequest = z.infer<typeof connectWhatsAppRequestSchema>

/** Only when WHATSAPP_DEV_CONNECT=true: Meta test number plus a system-user token. */
export const devConnectWhatsAppRequestSchema = z.object({
  wabaId: metaIdSchema,
  phoneNumberId: metaIdSchema,
  accessToken: z.string().trim().min(20).max(1024),
})
export type DevConnectWhatsAppRequest = z.infer<typeof devConnectWhatsAppRequestSchema>

export const rotateTokenRequestSchema = z
  .object({
    code: z.string().trim().min(1).max(2048).optional(),
    accessToken: z.string().trim().min(20).max(1024).optional(),
  })
  .refine((v) => Boolean(v.code) !== Boolean(v.accessToken), 'Provide either code or accessToken.')
export type RotateTokenRequest = z.infer<typeof rotateTokenRequestSchema>

export const updateConnectionRequestSchema = z
  .object({
    isDefault: z.literal(true),
    label: z.string().trim().max(60).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field.')
export type UpdateConnectionRequest = z.infer<typeof updateConnectionRequestSchema>

export const testConnectionResultSchema = z.object({
  ok: z.boolean(),
  status: z.enum(PHONE_STATUSES),
  qualityRating: z.enum(QUALITY_RATINGS),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
})
export type TestConnectionResult = z.infer<typeof testConnectionResultSchema>

/** Public values only. `embeddedSignup` is false until the Meta app is configured. */
export const whatsappSignupConfigSchema = z.object({
  embeddedSignup: z.boolean(),
  appId: z.string().nullable(),
  configId: z.string().nullable(),
  graphVersion: z.string(),
  devConnect: z.boolean(),
})
export type WhatsAppSignupConfig = z.infer<typeof whatsappSignupConfigSchema>

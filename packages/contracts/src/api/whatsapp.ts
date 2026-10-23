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
  /** ADR-0027: MANAGED = connected by Fenwira support (platform operator), read-only for tenants. */
  connectionMode: z.enum(['EMBEDDED_SIGNUP', 'MANAGED']),
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
      /** Last "Verify connection" (operator) and its outcome; null = never verified. */
      verifiedAt: z.string().nullable(),
      verifyOk: z.boolean().nullable(),
      verifyErrorCode: z.string().nullable(),
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

// ---------------------------------------------------------------------------------------------
// ADR-0027 Managed Launch Mode: operator-managed connections (/platform/workspaces/:id/whatsapp).
// Secrets travel only in these requests; responses carry masked values (last 4) and timestamps.
// ---------------------------------------------------------------------------------------------

const metaNumericId = z
  .string()
  .trim()
  .regex(/^\d{5,25}$/, 'Must be the numeric ID from Meta')
const metaToken = z.string().trim().min(20).max(2048).regex(/^\S+$/, 'No spaces in a token')
/** Meta app secrets are 32 hex characters; accept a little more in case Meta changes length. */
const metaAppSecret = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9]{16,128}$/, 'Paste the app secret from the Meta app dashboard')

export const managedConnectRequestSchema = z
  .object({
    wabaId: metaNumericId,
    phoneNumberId: metaNumericId,
    /** As shown in WhatsApp Manager; checked against what Meta reports for the number. */
    displayPhoneNumber: z.string().trim().min(5).max(32),
    /** Permanent system-user access token (never returned, never logged). */
    accessToken: metaToken,
    /** The app secret of the Meta app that sends this WABA's webhooks (ML-D1). Omit = platform app. */
    appSecret: metaAppSecret.optional(),
    /** That Meta app's ID: lets "Verify connection" ask debug_token with the app's own token. */
    appId: metaNumericId.optional(),
    /** Meta business portfolio ID that owns the WABA. */
    businessId: metaNumericId.optional(),
  })
  .strict()
export type ManagedConnectRequest = z.infer<typeof managedConnectRequestSchema>

export const managedRotateRequestSchema = z
  .object({
    accessToken: metaToken.optional(),
    appSecret: metaAppSecret.optional(),
    appId: metaNumericId.optional(),
  })
  .strict()
  .refine((v) => v.accessToken || v.appSecret || v.appId, {
    message: 'Provide a new access token, app secret or app ID.',
  })
export type ManagedRotateRequest = z.infer<typeof managedRotateRequestSchema>

const checkSchema = z.object({
  ok: z.boolean(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
})
/** "Verify connection": three live Graph checks, stored on the credential. */
export const verifyConnectionResultSchema = z.object({
  ok: z.boolean(),
  verifiedAt: z.string(),
  checks: z.object({ token: checkSchema, phoneNumber: checkSchema, waba: checkSchema }),
})
export type VerifyConnectionResult = z.infer<typeof verifyConnectionResultSchema>

export const platformWhatsAppConnectionSchema = whatsappConnectionSchema.extend({
  metaAppId: z.string().nullable(),
  businessId: z.string().nullable(),
  /** `••••abcd` only. */
  appSecret: z.object({ maskedSecret: z.string(), rotatedAt: z.string().nullable() }).nullable(),
  templatesSyncedAt: z.string().nullable(),
})
export type PlatformWhatsAppConnection = z.infer<typeof platformWhatsAppConnectionSchema>

export const templateSyncSummarySchema = z.object({
  syncedAt: z.string(),
  imported: z.number().int(),
  updated: z.number().int(),
  /** Templates Fenwira knows that Meta no longer returns. */
  missing: z.number().int(),
})
export type TemplateSyncSummary = z.infer<typeof templateSyncSummarySchema>

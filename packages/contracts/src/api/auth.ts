import { z } from 'zod'
import { roleSchema, type Permission } from '../rbac'
import { emailSchema, idSchema, passwordSchema } from './common'

export const registerRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: emailSchema,
  password: passwordSchema,
})
export type RegisterRequest = z.infer<typeof registerRequestSchema>

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
})
export type LoginRequest = z.infer<typeof loginRequestSchema>

/** 6-digit TOTP or a backup code (xxxxx-xxxxx). */
export const otpCodeSchema = z
  .string()
  .trim()
  .regex(/^(\d{6}|[a-z0-9]{5}-[a-z0-9]{5})$/i, 'Enter the 6-digit code or a backup code.')

export const twoFactorVerifyRequestSchema = z.object({
  challengeToken: z.string().min(10).max(2000),
  code: otpCodeSchema,
})
export const tokenRequestSchema = z.object({ token: z.string().min(20).max(200) })
export const forgotPasswordRequestSchema = z.object({ email: emailSchema })
export const resetPasswordRequestSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
})
export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
})
export const updateProfileRequestSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  timezone: z.string().min(1).max(64).optional(),
  locale: z.string().min(2).max(16).optional(),
})
export const twoFactorEnableRequestSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code.'),
})
export const twoFactorDisableRequestSchema = z.object({
  password: z.string().min(1).max(128),
  code: otpCodeSchema,
})

export const userSchema = z.object({
  id: idSchema,
  email: z.string(),
  name: z.string(),
  emailVerified: z.boolean(),
  twoFactorEnabled: z.boolean(),
  timezone: z.string(),
  locale: z.string(),
  createdAt: z.string(),
})
export type User = z.infer<typeof userSchema>

export const membershipSummarySchema = z.object({
  membershipId: idSchema,
  tenantId: idSchema,
  tenantName: z.string(),
  tenantSlug: z.string(),
  role: roleSchema,
  permissions: z.array(z.string()) as z.ZodType<Permission[]>,
  require2fa: z.boolean(),
})
export type MembershipSummary = z.infer<typeof membershipSummarySchema>

export const meSchema = z.object({
  user: userSchema,
  memberships: z.array(membershipSummarySchema),
  csrfToken: z.string(),
  /** Session deadlines: absolute (12 h from sign-in) and idle (last activity + 3 h). */
  session: z.object({ expiresAt: z.string(), idleExpiresAt: z.string() }).nullable().optional(),
  /** Platform product switches (ADR-0027 Managed Launch Mode). */
  features: z.object({ managedLaunch: z.boolean() }),
})
export type Me = z.infer<typeof meSchema>

export const loginResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('AUTHENTICATED'), csrfToken: z.string() }),
  z.object({ status: z.literal('TOTP_REQUIRED'), challengeToken: z.string() }),
])
export type LoginResult = z.infer<typeof loginResultSchema>

export const sessionSchema = z.object({
  id: idSchema,
  userAgent: z.string().nullable(),
  ip: z.string().nullable(),
  createdAt: z.string(),
  lastUsedAt: z.string(),
  current: z.boolean(),
})
export type Session = z.infer<typeof sessionSchema>

export const twoFactorSetupSchema = z.object({ secret: z.string(), otpauthUri: z.string() })
export type TwoFactorSetup = z.infer<typeof twoFactorSetupSchema>
export const backupCodesSchema = z.object({ backupCodes: z.array(z.string()) })

export const SECURITY_EVENT_TYPES = [
  'LOGIN_SUCCEEDED',
  'LOGIN_FAILED',
  'LOGOUT',
  'PASSWORD_CHANGED',
  'PASSWORD_RESET',
  'EMAIL_VERIFIED',
  'TWO_FACTOR_ENABLED',
  'TWO_FACTOR_DISABLED',
  'BACKUP_CODE_USED',
  'SESSION_REVOKED',
  'ALL_SESSIONS_REVOKED',
  'REFRESH_TOKEN_REUSE',
] as const
export const securityEventTypeSchema = z.enum(SECURITY_EVENT_TYPES)
export type SecurityEventType = z.infer<typeof securityEventTypeSchema>

export const securityEventSchema = z.object({
  id: idSchema,
  type: securityEventTypeSchema,
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string(),
})
export type SecurityEvent = z.infer<typeof securityEventSchema>

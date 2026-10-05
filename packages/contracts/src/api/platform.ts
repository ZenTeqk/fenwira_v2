import { z } from 'zod'
export const PLATFORM_PERMISSIONS = [
  'commercial.read',
  'financial.read',
  'wallet.manage',
  'subscription.manage',
  'entitlements.manage',
  'audit.read',
] as const
export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number]
export const platformLoginSchema = z
  .object({ email: z.email().toLowerCase(), password: z.string().min(1).max(256) })
  .strict()
export const platformVerifySchema = z
  .object({ challengeToken: z.string().min(20).max(256), code: z.string().regex(/^\d{6}$/) })
  .strict()
export const platformReauthSchema = z
  .object({ password: z.string().min(1).max(256), code: z.string().regex(/^\d{6}$/) })
  .strict()
export const platformMeSchema = z.object({
  operatorId: z.uuid(),
  permissions: z.array(z.enum(PLATFORM_PERMISSIONS)),
  expiresAt: z.iso.datetime(),
  csrfToken: z.string(),
})
export type PlatformMe = z.infer<typeof platformMeSchema>

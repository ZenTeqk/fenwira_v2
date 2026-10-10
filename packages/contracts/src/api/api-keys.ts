import { z } from 'zod'
import { type PERMISSION_KEYS } from '../rbac'

/**
 * API keys (docs/API_KEYS.md, decisions P11-D18, P11-D22). A key's scopes are permission keys
 * from this catalog only — the exact set the public API surface needs (`PHASE_11_PLAN.md` §5.1a).
 * Never every permission: keys can't reach billing, platform, team, roles, security, audit,
 * WhatsApp connections, imports/exports, automation administration or webhook management.
 */
export const API_KEY_SCOPES = [
  'contacts.read',
  'contacts.write',
  'inbox.read',
  'inbox.reply',
  'templates.read',
  'campaigns.read',
] as const satisfies readonly (typeof PERMISSION_KEYS)[number][]
export const apiKeyScopeSchema = z.enum(API_KEY_SCOPES)
export type ApiKeyScope = z.infer<typeof apiKeyScopeSchema>

export const apiKeySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** The public, non-secret part of the key: shown always, e.g. in the "used by" audit trail. */
  prefix: z.string(),
  scopes: z.array(apiKeyScopeSchema),
  createdBy: z.uuid().nullable(),
  createdByName: z.string().nullable(),
  lastUsedAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
})
export type ApiKey = z.infer<typeof apiKeySchema>

export const createApiKeyRequestSchema = z.object({
  name: z.string().min(1).max(80),
  scopes: z.array(apiKeyScopeSchema).min(1),
  /** Optional expiry; unset = never expires. */
  expiresAt: z.iso.datetime({ offset: true }).optional(),
})
export type CreateApiKeyRequest = z.infer<typeof createApiKeyRequestSchema>

/** Returned once, at creation only: `secret` never appears in any later response or log. */
export const createdApiKeySchema = z.object({
  key: apiKeySchema,
  secret: z.string(),
})
export type CreatedApiKey = z.infer<typeof createdApiKeySchema>

/** `fw_<8-char prefix>_<secret>` — parsed by the guard; never logged (docs/SECURITY.md). */
export const API_KEY_TOKEN_RE = /^fw_([A-Za-z0-9]{8})_([A-Za-z0-9_-]{20,128})$/

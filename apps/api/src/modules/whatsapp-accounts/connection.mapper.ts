import {
  CONNECTION_STEP_KEYS,
  type ConnectionStep,
  type ConnectionStepKey,
  connectionStepSchema,
  type WhatsAppConnection,
} from '@fenwira/contracts'
import { type Prisma } from '@fenwira/database'
import { z } from 'zod'

/** Everything toConnection() needs, loaded in one query. */
export const CONNECTION_INCLUDE = {
  waba: {
    include: {
      credentials: {
        where: { status: { not: 'REVOKED' } },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
      webhookSubscriptions: true,
    },
  },
} as const satisfies Prisma.WhatsAppPhoneNumberInclude

export type PhoneWithRelations = Prisma.WhatsAppPhoneNumberGetPayload<{
  include: typeof CONNECTION_INCLUDE
}>

/** `EAAG…9f2c`: enough to recognize a token, useless to anyone who sees it. */
export const maskToken = (prefix: string, last4: string) => `${prefix}…${last4}`
export const tokenParts = (token: string) => ({
  tokenPrefix: token.slice(0, 4),
  tokenLast4: token.slice(-4),
})

export function freshSteps(): ConnectionStep[] {
  return CONNECTION_STEP_KEYS.map((key) => ({ key, status: 'PENDING' as const }))
}

export function readSteps(value: unknown): ConnectionStep[] {
  const parsed = z.array(connectionStepSchema).safeParse(value)
  return parsed.success ? parsed.data : freshSteps()
}

export function setStep(
  steps: ConnectionStep[],
  key: ConnectionStepKey,
  status: ConnectionStep['status'],
  error?: { code: string; message: string },
): ConnectionStep[] {
  return steps.map((s) => (s.key === key ? { key, status, ...(error ? { error } : {}) } : s))
}

export function toConnection(p: PhoneWithRelations): WhatsAppConnection {
  const credential = p.waba.credentials[0]
  const webhook = p.waba.webhookSubscriptions[0]
  return {
    id: p.id,
    phoneNumberId: p.phoneNumberId,
    displayPhoneNumber: p.displayPhoneNumber,
    verifiedName: p.verifiedName,
    label: p.label,
    waba: { id: p.waba.wabaId, name: p.waba.name },
    status: p.status,
    qualityRating: p.qualityRating,
    messagingLimitTier: p.messagingLimitTier,
    throughputMps: p.throughputMps,
    isDefault: p.isDefault,
    webhookStatus: webhook?.status ?? null,
    credential: credential
      ? {
          status: credential.status,
          tokenType: credential.tokenType,
          maskedToken: maskToken(credential.tokenPrefix, credential.tokenLast4),
          expiresAt: credential.expiresAt?.toISOString() ?? null,
        }
      : null,
    steps: readSteps(p.statusDetail),
    lastSyncedAt: p.lastSyncedAt?.toISOString() ?? null,
    connectedAt: p.connectedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
  }
}

const META_STATUS: Record<string, WhatsAppConnection['status']> = {
  CONNECTED: 'CONNECTED',
  FLAGGED: 'FLAGGED',
  RESTRICTED: 'RESTRICTED',
  RATE_LIMITED: 'RESTRICTED',
  BANNED: 'RESTRICTED',
  DISCONNECTED: 'ERROR',
  DELETED: 'ERROR',
  PENDING: 'PENDING',
}

/** Meta's phone `status` → ours. Unknown values keep the current status. */
export const phoneStatusFromMeta = (
  status: string | undefined,
  current: WhatsAppConnection['status'],
): WhatsAppConnection['status'] => (status && META_STATUS[status]) || current

const QUALITY = new Set(['GREEN', 'YELLOW', 'RED'])
export const qualityFromMeta = (q: string | undefined): WhatsAppConnection['qualityRating'] =>
  q && QUALITY.has(q) ? (q as 'GREEN' | 'YELLOW' | 'RED') : 'UNKNOWN'

/** Credential health from debug_token's expires_at (0 = never). */
export function credentialStatusFor(
  expiresAtSec: number,
  now = Date.now(),
): {
  status: 'VALID' | 'EXPIRING'
  expiresAt: Date | null
} {
  if (!expiresAtSec) return { status: 'VALID', expiresAt: null }
  const expiresAt = new Date(expiresAtSec * 1000)
  const soon = expiresAt.getTime() - now < 7 * 24 * 3600 * 1000
  return { status: soon ? 'EXPIRING' : 'VALID', expiresAt }
}

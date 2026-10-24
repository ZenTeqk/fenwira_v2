import { decryptSecret } from '@fenwira/config'
import { type TenantTx } from '@fenwira/database'
import { type GraphClient, GraphError, type TokenInfo } from '@fenwira/whatsapp'
import { requestContext } from '../../core/context/request-context'
import { type WhatsAppOptions } from './whatsapp.options'

/** A connection step that failed for a Fenwira-side reason (Graph failures arrive as GraphError). */
export class StepFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'StepFailure'
  }
}

/** Safe, user-facing error for a step. GraphError messages are Meta's text and never contain our token. */
export function stepError(err: unknown): { code: string; message: string } | null {
  if (err instanceof StepFailure) return { code: err.code, message: err.message }
  if (err instanceof GraphError)
    return { code: err.fenwiraCode, message: `${err.title}: ${err.message}` }
  return null
}

/** debug_token needs an app token when we have one; a token can also inspect itself. */
export const appTokenFor = (options: WhatsAppOptions, token: string) =>
  options.appId && options.appSecret ? `${options.appId}|${options.appSecret}` : token

const REQUIRED_SCOPES = ['whatsapp_business_management', 'whatsapp_business_messaging']

/** Step VERIFY: the token is valid, has WhatsApp scopes and (when granular) covers this WABA. */
export async function verifyToken(
  graph: GraphClient,
  options: WhatsAppOptions,
  token: string,
  wabaId: string,
  /** ML-D1: the WABA's own Meta app (`appId|appSecret`); default = the platform app or self. */
  appToken?: string,
): Promise<TokenInfo> {
  const info = await graph.debugToken(token, appToken ?? appTokenFor(options, token))
  if (!info.isValid)
    throw new StepFailure('META_TOKEN_INVALID', 'Meta says this token is not valid.')
  if (!REQUIRED_SCOPES.every((s) => info.scopes.includes(s)))
    throw new StepFailure('META_PERMISSION_DENIED', 'The token is missing WhatsApp permissions.')
  const targets = info.granularTargets.whatsapp_business_management
  if (targets && targets.length > 0 && !targets.includes(wabaId))
    throw new StepFailure(
      'META_WABA_NOT_GRANTED',
      "The token doesn't grant access to this WhatsApp Business Account.",
    )
  return info
}

/** App token of a customer's own Meta app, when both halves are known (ML-D1). */
export const ownAppToken = (appId?: string | null, appSecret?: string | null) =>
  appId && appSecret ? `${appId}|${appSecret}` : undefined

/** Digits only, for comparing phone numbers typed by people with Meta's display format. */
export const phoneDigits = (value: string) => value.replace(/\D/g, '')

export const decryptToken = (options: WhatsAppOptions, ciphertext: Uint8Array | null) =>
  ciphertext ? decryptSecret(options.keyRing, ciphertext) : null

export async function emitConnectionChanged(
  tx: TenantTx,
  tenantId: string,
  phoneId: string,
  change: 'CONNECTED' | 'DISCONNECTED' | 'STATUS_CHANGED' | 'CREDENTIAL_CHANGED',
): Promise<void> {
  await tx.outboxEvent.create({
    data: {
      tenantId,
      eventType: 'whatsapp.connection.changed',
      aggregateType: 'whatsapp_phone_number',
      aggregateId: phoneId,
      payload: { phoneId, change },
      correlationId: requestContext.correlationId() ?? null,
    },
  })
}

/** Webhook fields Fenwira relies on (docs/META_INTEGRATION.md → Webhook fields subscribed). */
export const SUBSCRIBED_FIELDS = [
  'messages',
  'message_template_status_update',
  'message_template_quality_update',
  'template_category_update',
  'phone_number_quality_update',
  'account_update',
]

export const THROUGHPUT_MPS: Record<string, number> = { HIGH: 1000, STANDARD: 80 }

/** Meta's developer test numbers are US +1 555 numbers; they come pre-registered by Meta. */
export const isMetaTestNumber = (display: string | null | undefined) =>
  /^1555\d{7}$/.test(phoneDigits(display ?? ''))

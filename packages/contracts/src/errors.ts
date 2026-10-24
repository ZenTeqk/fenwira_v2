import { z } from 'zod'

/**
 * Closed catalog of API error codes (docs/API_SPEC.md → Errors). Phases append codes here;
 * the web app maps every code to user-facing copy.
 */
export const ERROR_CODES = [
  // 400
  'VALIDATION_FAILED',
  'INVALID_CURSOR',
  // 401
  'UNAUTHENTICATED',
  'SESSION_EXPIRED',
  'INVALID_CREDENTIALS',
  'TOTP_REQUIRED',
  'INVALID_CODE',
  // 403
  'FORBIDDEN',
  'CSRF_FAILED',
  'EMAIL_NOT_VERIFIED',
  'TWO_FACTOR_ENROLLMENT_REQUIRED',
  // 404
  'NOT_FOUND',
  'TENANT_NOT_FOUND',
  // 409
  'CONFLICT',
  'COMPOSE_LOCKED',
  'IDEMPOTENCY_KEY_REUSED',
  'IDEMPOTENCY_IN_PROGRESS',
  'EMAIL_TAKEN',
  'TOKEN_INVALID',
  'PHONE_NUMBER_ALREADY_CONNECTED',
  'TEMPLATE_NAME_TAKEN',
  'TEMPLATE_NOT_EDITABLE',
  // 422
  'UNPROCESSABLE',
  'WHATSAPP_CONNECT_FAILED',
  'NO_CONNECTED_NUMBER',
  'CONTACT_BLOCKED',
  'CONVERSATION_WINDOW_CLOSED',
  'CONSENT_REQUIRED',
  'AUTOMATION_BLOCKED_BY_TAKEOVER',
  'INVALID_PHONE',
  'FILE_NOT_READY',
  'LIMIT_EXCEEDED',
  'IMPORT_NOT_READY',
  'TEMPLATE_INVALID',
  'TEMPLATE_NOT_APPROVED',
  'TEMPLATE_VARIABLES_INVALID',
  'INSUFFICIENT_BALANCE',
  'CAMPAIGN_NOT_READY',
  'CAMPAIGN_INVALID_STATE',
  'FLOW_INVALID',
  'VERSION_CONFLICT',
  'FLOW_INVALID_STATE',
  'ENTITLEMENT_REQUIRED',
  'SUBSCRIPTION_INACTIVE',
  // ADR-0027 manual UPI billing
  'SUBSCRIPTION_SUSPENDED',
  'UPI_NOT_CONFIGURED',
  /** Managed Launch: the wallet is off for customers, so no wallet top-up invoices. */
  'WALLET_TOPUP_DISABLED',
  'INVOICE_ALREADY_OPEN',
  'INVOICE_NOT_OPEN',
  'PAYMENT_PENDING',
  'ALREADY_REVIEWED',
  'UTR_ALREADY_USED',
  'EXPORT_TOO_LARGE',
  'WEBHOOK_URL_INVALID',
  'WEBHOOK_BLOCKED_DESTINATION',
  'API_KEY_SCOPE_INVALID',
  // 429
  'RATE_LIMITED',
  // 5xx
  'INTERNAL',
  'UPSTREAM_UNAVAILABLE',
] as const

export const errorCodeSchema = z.enum(ERROR_CODES)
export type ErrorCode = z.infer<typeof errorCodeSchema>

export const fieldErrorSchema = z.object({
  path: z.string(),
  code: z.string(),
  message: z.string(),
})
export type FieldError = z.infer<typeof fieldErrorSchema>

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
    fieldErrors: z.array(fieldErrorSchema).optional(),
    correlationId: z.string(),
  }),
})
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>

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
  /** Upgrade now: off outside Managed Launch / plan already active / plan has no price. */
  'UPGRADE_UNAVAILABLE',
  'PLAN_ACTIVE',
  'PLAN_NOT_PRICED',
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
    /** Plain-English next step for the reader. */
    hint: z.string().optional(),
    correlationId: z.string(),
    /** Same value as correlationId; quote it to support. */
    requestId: z.string().optional(),
  }),
})
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>

// Plain-English field messages (shared by the API envelope and browser-side validation).
const ZOD_DEFAULT = /^(Invalid|Too (small|big)|Unrecognized key|Expected|Required)/i

/** One plain sentence per field problem; custom schema messages are already plain and kept. */
export function plainIssue(issue: {
  code: string
  message: string
  input?: unknown
  minimum?: unknown
  maximum?: unknown
  origin?: unknown
}): string {
  if (!ZOD_DEFAULT.test(issue.message)) return issue.message
  const text = issue.origin === 'string'
  switch (issue.code) {
    case 'invalid_type':
      return issue.input === undefined
        ? 'This field is required.'
        : 'This value has the wrong type.'
    case 'too_small':
      return text
        ? Number(issue.minimum) <= 1
          ? 'This field is required.'
          : `Must be at least ${String(issue.minimum)} characters.`
        : `Must be at least ${String(issue.minimum)}.`
    case 'too_big':
      return text
        ? `Must be at most ${String(issue.maximum)} characters.`
        : `Must be at most ${String(issue.maximum)}.`
    case 'invalid_format':
    case 'invalid_string':
      return 'This value is not in the expected format.'
    case 'invalid_value':
    case 'invalid_enum_value':
      return 'Choose one of the allowed options.'
    case 'unrecognized_keys':
      return 'This field is not accepted here.'
    default:
      return 'This value is not valid.'
  }
}

export function plainFieldErrors(
  issues: ReadonlyArray<Parameters<typeof plainIssue>[0] & { path: PropertyKey[] }>,
): FieldError[] {
  return issues.map((i) => ({
    path: i.path.map(String).join('.'),
    code: i.code,
    message: plainIssue(i),
  }))
}

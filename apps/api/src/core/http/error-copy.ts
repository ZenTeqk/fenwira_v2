import { type ErrorCode } from '@fenwira/contracts'

export { plainFieldErrors, plainIssue } from '@fenwira/contracts'

/**
 * Plain-English copy for the error envelope. `message` says what happened to a non-technical
 * operator or customer; `hint` says what to do next. A code-specific message from the service
 * wins unless the code is listed in REPLACE_MESSAGE (whose service messages are too technical).
 */
export const ERROR_COPY: Partial<Record<ErrorCode, { message?: string; hint: string }>> = {
  VALIDATION_FAILED: {
    message: 'Some fields need attention.',
    hint: 'Fix the highlighted fields and try again.',
  },
  UNAUTHENTICATED: { message: 'You are signed out.', hint: 'Sign in again, then retry.' },
  SESSION_EXPIRED: { message: 'Your session has ended.', hint: 'Sign in again, then retry.' },
  INVALID_CREDENTIALS: {
    message: 'The email or password is not correct.',
    hint: 'Check both and try again. After several attempts you must wait a few minutes.',
  },
  INVALID_CODE: {
    message: 'The authenticator code is not correct.',
    hint: 'Use the 6-digit code currently shown in your authenticator app.',
  },
  TOTP_REQUIRED: {
    message: 'Your identity check has expired.',
    hint: 'Verify your identity (password and authenticator code), then retry. The check lasts 5 minutes.',
  },
  FORBIDDEN: { hint: 'Ask a workspace owner or a Fenwira operator for access.' },
  CSRF_FAILED: {
    message: 'This page is out of date.',
    hint: 'Reload the page, then try again.',
  },
  NOT_FOUND: { hint: 'It may have been deleted. Go back and refresh the list.' },
  TENANT_NOT_FOUND: { hint: 'Check the workspace link, or search for the workspace again.' },
  CONFLICT: { hint: 'Refresh the page to see the latest state, then try again.' },
  VERSION_CONFLICT: {
    message: 'Someone else changed this in the meantime.',
    hint: 'Refresh the page to load the latest version, then make your change again.',
  },
  PHONE_NUMBER_ALREADY_CONNECTED: {
    message: 'This WhatsApp number is already connected to another workspace.',
    hint: 'Disconnect it from the other workspace first, or use a different number.',
  },
  WHATSAPP_CONNECT_FAILED: {
    message: 'Meta did not accept the connection.',
    hint: 'Check the highlighted field against WhatsApp Manager, then retry.',
  },
  NO_CONNECTED_NUMBER: {
    message: 'No WhatsApp number is connected.',
    hint: 'Connect a WhatsApp number first.',
  },
  UPI_NOT_CONFIGURED: {
    message: 'UPI payment details are not set up on the server.',
    hint: 'Set the UPI ID and payee name in the server settings (see MANAGED_LAUNCH.md), then retry.',
  },
  UPGRADE_UNAVAILABLE: {
    hint: 'Internal workspaces do not need billing. For customer workspaces, check the plan and its price.',
  },
  PLAN_NOT_PRICED: {
    message: 'This plan has no price yet.',
    hint: 'Set a price under Plans & prices, or enter a custom amount.',
  },
  INVOICE_ALREADY_OPEN: { hint: 'Void the open invoice first, or wait for it to be paid.' },
  INVOICE_NOT_OPEN: { hint: 'Only open invoices can be changed. Refresh to see its status.' },
  ALREADY_REVIEWED: { hint: 'Refresh the list; another operator may have handled it.' },
  UTR_ALREADY_USED: {
    message: 'This UTR was already used for another payment.',
    hint: 'Ask the customer to check the UTR on their bank statement.',
  },
  IDEMPOTENCY_IN_PROGRESS: {
    message: 'The same request is still being processed.',
    hint: 'Wait a few seconds, then refresh.',
  },
  LIMIT_EXCEEDED: { hint: 'Upgrade the plan or remove items to stay within the limit.' },
  ENTITLEMENT_REQUIRED: { hint: 'This feature is not on the current plan.' },
  AI_NOT_ENABLED: {
    message: 'AI Assistant is not enabled for this workspace.',
    hint: 'Contact Fenwira to add AI Assistant to your plan.',
  },
  AI_QUOTA_EXHAUSTED: {
    hint: 'The monthly AI reply allowance is used up. Contact Fenwira to raise it, or wait for next month.',
  },
  RATE_LIMITED: {
    message: 'Too many attempts in a short time.',
    hint: 'Wait a few minutes, then try again.',
  },
  UPSTREAM_UNAVAILABLE: {
    message: 'A service Fenwira depends on is not responding.',
    hint: 'Try again in a minute. If it keeps happening, share the request ID with support.',
  },
  INTERNAL: {
    message: 'Something went wrong on our side.',
    hint: 'Try again. If it keeps happening, share the request ID with Fenwira support.',
  },
}

/** Codes whose service-level messages are replaced by the catalog copy above. */
export const REPLACE_MESSAGE = new Set<ErrorCode>([
  'TOTP_REQUIRED',
  'INVALID_CODE',
  'INVALID_CREDENTIALS',
  'PHONE_NUMBER_ALREADY_CONNECTED',
  'RATE_LIMITED',
  'INTERNAL',
  'UPSTREAM_UNAVAILABLE',
])

/**
 * Meta Graph / connection-check failures (WHATSAPP_CONNECT_FAILED details.reason). `field` is the
 * Connect WhatsApp form field the operator should fix.
 */
export const META_COPY: Record<string, { message: string; hint: string; field?: string }> = {
  META_TOKEN_INVALID: {
    message: 'Meta says the access token is invalid or expired.',
    hint: 'Create a new permanent system-user token in Meta Business Settings and paste it again.',
    field: 'accessToken',
  },
  META_PERMISSION_DENIED: {
    message: 'The access token is missing WhatsApp permissions.',
    hint: 'Give the system user whatsapp_business_management and whatsapp_business_messaging, then generate a new token.',
    field: 'accessToken',
  },
  META_WABA_NOT_GRANTED: {
    message: 'The access token does not cover this WhatsApp Business Account.',
    hint: 'Check the WABA ID, or assign this WABA to the system user and generate a new token.',
    field: 'wabaId',
  },
  META_PHONE_NOT_IN_WABA: {
    message: 'This phone number ID is not part of that WhatsApp Business Account.',
    hint: 'Copy the phone number ID from WhatsApp Manager → Phone numbers for this WABA.',
    field: 'phoneNumberId',
  },
  META_DISPLAY_NUMBER_MISMATCH: {
    message: 'The display phone number does not match what Meta reports for this phone number ID.',
    hint: 'Type the number exactly as WhatsApp Manager shows it, or check the phone number ID.',
    field: 'displayPhoneNumber',
  },
  META_PHONE_NOT_CONNECTED: {
    message: 'Meta reports this number as not registered yet.',
    hint: 'Finish the number setup in WhatsApp Manager (verify and register it), then retry.',
    field: 'phoneNumberId',
  },
  REGISTRATION_PIN_MISSING: {
    message: 'The number is not registered with Meta and Fenwira has no registration PIN for it.',
    hint: 'Disconnect and connect the number again so Fenwira can register it.',
  },
  META_INVALID_PARAMETER: {
    message: 'Meta did not recognise one of the IDs.',
    hint: 'Check the WABA ID and phone number ID in WhatsApp Manager; they are long numbers, not phone numbers.',
    field: 'wabaId',
  },
  META_RATE_LIMITED: {
    message: 'Meta is rate-limiting requests for this account.',
    hint: 'Wait a few minutes, then retry.',
  },
  META_UNAVAILABLE: {
    message: 'Meta is not responding right now.',
    hint: 'Retry in a few minutes.',
  },
  META_TRANSIENT: { message: 'Meta had a temporary problem.', hint: 'Retry in a minute.' },
  META_ACCOUNT_LOCKED: {
    message: 'Meta has locked this WhatsApp account.',
    hint: 'Open WhatsApp Manager to see why, and resolve it there.',
  },
  META_UNKNOWN_ERROR: {
    message: 'Meta returned an unexpected error.',
    hint: 'Retry. If it keeps happening, share the request ID with support.',
  },
}

/** Masks secrets in a raw error message before it is logged next to the request ID. */
export function maskSecrets(text: string): string {
  return text
    .replace(/\b(postgres(?:ql)?|redis|amqp|mysql):\/\/[^\s'"]+/gi, '$1://[MASKED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [MASKED]')
    .replace(/\bEAA[A-Za-z0-9]{10,}\b/g, 'EAA[MASKED]')
    .replace(/\b(password|secret|token|apikey|api_key)=([^\s&]+)/gi, '$1=[MASKED]')
    .slice(0, 500)
}

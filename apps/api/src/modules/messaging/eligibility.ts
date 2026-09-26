import { type ErrorCode } from '@fenwira/contracts'
import { Injectable } from '@nestjs/common'
import { AppError } from '../../core/http/app-error'

/**
 * MessageEligibilityService — the one place that decides whether an outbound message may be sent
 * (docs/CONTACTS_AND_CONSENT.md → Eligibility, decisions C1/C3). MessagingService calls it at
 * accept time and the outbound worker again at send time; no other module decides eligibility.
 *
 * Rules run in order and the first denial wins. New inputs (tenant policy, further Meta
 * requirements, suppression lists) are added as rules here, never as checks in callers.
 */

export type MessagePurpose = 'MARKETING' | 'UTILITY' | 'SERVICE'
export type TemplateCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
type ConsentState = 'NONE' | 'GRANTED' | 'REVOKED'

export interface EligibilityInput {
  purpose: MessagePurpose
  /** The template's Meta category, once templates carry one (Phase 8). Wins over `purpose`. */
  category?: TemplateCategory | null
  /** Message content type; anything but TEMPLATE is freeform. */
  contentType: string
  contact: {
    status: string
    deletedAt: Date | null
    marketingConsent: ConsentState
    utilityConsent: ConsentState
  }
  serviceWindowExpiresAt: Date | null
  now?: Date
}

export const RULES = {
  SUPPRESSED_CONTACT: 'SUPPRESSED_CONTACT',
  MARKETING_REQUIRES_CONSENT: 'MARKETING_REQUIRES_CONSENT',
  TEMP_UTILITY_BLOCK_ON_REVOKED: 'TEMP_UTILITY_BLOCK_ON_REVOKED',
  TEMP_AUTHENTICATION_BLOCK_ON_REVOKED: 'TEMP_AUTHENTICATION_BLOCK_ON_REVOKED',
  SERVICE_NO_CONSENT_CHECK: 'SERVICE_NO_CONSENT_CHECK',
  FREEFORM_NEEDS_SERVICE_WINDOW: 'FREEFORM_NEEDS_SERVICE_WINDOW',
} as const
export type RuleId = (typeof RULES)[keyof typeof RULES]

/**
 * TEMPORARY rules (decision C3): interim behavior until the final UTILITY/AUTHENTICATION policy
 * matrix exists. They are not business rules — tests pin them so a change is deliberate, and
 * nothing outside this file may depend on them.
 */
export const TEMPORARY_RULES: readonly RuleId[] = [
  RULES.TEMP_UTILITY_BLOCK_ON_REVOKED,
  RULES.TEMP_AUTHENTICATION_BLOCK_ON_REVOKED,
]

export type EligibilityDecision =
  | { allowed: true; rules: RuleId[] }
  | {
      allowed: false
      rule: RuleId
      code: Extract<
        ErrorCode,
        'CONTACT_BLOCKED' | 'CONSENT_REQUIRED' | 'CONVERSATION_WINDOW_CLOSED'
      >
      reason: string
      /** True when the contact explicitly opted out (vs. never consented). */
      optedOut: boolean
      rules: RuleId[]
    }

type Denial = Omit<Extract<EligibilityDecision, { allowed: false }>, 'allowed' | 'rule' | 'rules'>
type Rule = {
  id: RuleId
  applies: (i: EligibilityInput, cls: TemplateCategory | 'SERVICE') => boolean
  deny: (i: EligibilityInput) => Denial | null
}

const consentDenied = (reason: string, optedOut: boolean): Denial => ({
  code: 'CONSENT_REQUIRED',
  reason,
  optedOut,
})

const ORDER: Rule[] = [
  {
    id: RULES.SUPPRESSED_CONTACT,
    applies: () => true,
    deny: (i) =>
      i.contact.status === 'BLOCKED' || i.contact.deletedAt
        ? { code: 'CONTACT_BLOCKED', reason: 'This contact is blocked.', optedOut: false }
        : null,
  },
  {
    id: RULES.MARKETING_REQUIRES_CONSENT,
    applies: (_, cls) => cls === 'MARKETING',
    deny: (i) =>
      i.contact.marketingConsent === 'GRANTED'
        ? null
        : consentDenied(
            'This contact has not opted in to marketing messages.',
            i.contact.marketingConsent === 'REVOKED',
          ),
  },
  {
    id: RULES.TEMP_UTILITY_BLOCK_ON_REVOKED,
    applies: (_, cls) => cls === 'UTILITY',
    deny: (i) =>
      i.contact.utilityConsent === 'REVOKED'
        ? consentDenied('This contact opted out of these messages.', true)
        : null,
  },
  {
    id: RULES.TEMP_AUTHENTICATION_BLOCK_ON_REVOKED,
    applies: (_, cls) => cls === 'AUTHENTICATION',
    deny: (i) =>
      i.contact.utilityConsent === 'REVOKED'
        ? consentDenied('This contact opted out of these messages.', true)
        : null,
  },
  { id: RULES.SERVICE_NO_CONSENT_CHECK, applies: (_, cls) => cls === 'SERVICE', deny: () => null },
  {
    id: RULES.FREEFORM_NEEDS_SERVICE_WINDOW,
    applies: (i) => i.contentType !== 'TEMPLATE',
    deny: (i) =>
      i.serviceWindowExpiresAt && i.serviceWindowExpiresAt > (i.now ?? new Date())
        ? null
        : {
            code: 'CONVERSATION_WINDOW_CLOSED',
            optedOut: false,
            reason:
              'The 24-hour window is closed. Send an approved template to restart the conversation.',
          },
  },
]

/** Pure evaluation, shared by the service and tests. */
export function evaluateEligibility(input: EligibilityInput): EligibilityDecision {
  const cls = input.category ?? input.purpose
  const rules: RuleId[] = []
  for (const rule of ORDER) {
    if (!rule.applies(input, cls)) continue
    rules.push(rule.id)
    const denial = rule.deny(input)
    if (denial) return { allowed: false, rule: rule.id, rules, ...denial }
  }
  return { allowed: true, rules }
}

@Injectable()
export class MessageEligibilityService {
  evaluate(input: EligibilityInput): EligibilityDecision {
    return evaluateEligibility(input)
  }

  /** Throws the typed 422 for a denial (accept time). */
  assert(input: EligibilityInput): void {
    const d = this.evaluate(input)
    if (!d.allowed)
      throw new AppError(d.code, 422, d.reason, {
        purpose: input.purpose,
        rule: d.rule,
        optedOut: d.optedOut,
      })
  }
}

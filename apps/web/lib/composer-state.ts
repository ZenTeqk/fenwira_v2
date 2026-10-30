import { type ContactEligibility, type PhoneStatus } from '@fenwira/contracts'

/**
 * What the reply composer offers, from the server's eligibility result (decision C1: the browser
 * never re-implements consent rules; it only chooses how to present the server's verdicts).
 */
export type ComposerState =
  | { kind: 'checking' }
  | { kind: 'reply' }
  /** Window open, but the server would refuse free text (e.g. opted out). */
  | { kind: 'reply-restricted'; reason: string }
  /** Window closed and an approved template can be sent. */
  | { kind: 'template-only' }
  /** Nothing can be sent right now; no action is offered. */
  | { kind: 'blocked'; title: string; message: string }

/** Statuses of the sending number under which no message can go out. */
const NUMBER_BLOCKS: Partial<Record<PhoneStatus, string>> = {
  DISCONNECTED: 'This WhatsApp number is disconnected. Reconnect it before sending.',
  RESTRICTED:
    'Meta has restricted this WhatsApp number. Messages can’t be sent until it is lifted.',
  ERROR: 'This WhatsApp number has a connection error. Check the connection before sending.',
  PENDING: 'This WhatsApp number is still being set up. Sending starts once it is connected.',
}

export function composerState(input: {
  windowOpen: boolean
  eligibility: ContactEligibility | undefined
  numberStatus: PhoneStatus | undefined
  canSendTemplates: boolean
}): ComposerState {
  const { windowOpen, eligibility, numberStatus, canSendTemplates } = input
  const numberBlock = numberStatus ? NUMBER_BLOCKS[numberStatus] : undefined
  if (numberBlock)
    return { kind: 'blocked', title: 'WhatsApp number unavailable', message: numberBlock }
  if (!eligibility) return { kind: 'checking' }
  // A blocked contact or consent restriction must not be described as a closed window.
  if (!eligibility.freeform.allowed && eligibility.freeform.code !== 'CONVERSATION_WINDOW_CLOSED')
    return {
      kind: 'reply-restricted',
      reason: eligibility.freeform.reason ?? 'Review messaging eligibility in the contact details.',
    }
  if (windowOpen && eligibility.freeform.allowed) return { kind: 'reply' }
  if (!canSendTemplates)
    return {
      kind: 'blocked',
      title: 'Template messages unavailable',
      message: 'Only an approved template can reach this customer, and your role can’t send one.',
    }
  if (!eligibility.utilityTemplate.allowed && !eligibility.marketingTemplate.allowed)
    return {
      kind: 'blocked',
      title: 'Template messages unavailable',
      message:
        eligibility.utilityTemplate.reason ??
        eligibility.marketingTemplate.reason ??
        'This customer can’t receive template messages right now.',
    }
  return { kind: 'template-only' }
}

import { type ContactEligibility } from '@fenwira/contracts'
import { describe, expect, it } from 'vitest'
import { composerState } from '../lib/composer-state'

const verdict = (allowed: boolean, reason: string | null = null) => ({
  allowed,
  code: allowed ? null : 'BLOCKED',
  reason,
  optedOut: false,
})
const eligibility = (
  freeform: boolean,
  utility: boolean,
  marketing: boolean,
  reason: string | null = null,
): ContactEligibility => ({
  freeform: verdict(freeform, reason),
  utilityTemplate: verdict(utility, reason),
  marketingTemplate: verdict(marketing, reason),
  serviceWindowExpiresAt: null,
})
const base = { numberStatus: 'CONNECTED' as const, canSendTemplates: true }

describe('composerState', () => {
  it('window open: free text, unless the server refuses it', () => {
    expect(
      composerState({ ...base, windowOpen: true, eligibility: eligibility(true, true, true) }),
    ).toEqual({ kind: 'reply' })
    expect(
      composerState({
        ...base,
        windowOpen: true,
        eligibility: eligibility(false, true, true, 'The customer opted out.'),
      }),
    ).toEqual({ kind: 'reply-restricted', reason: 'The customer opted out.' })
  })

  it('window closed: Choose template when a template can be sent', () => {
    expect(
      composerState({ ...base, windowOpen: false, eligibility: eligibility(false, true, false) }),
    ).toEqual({ kind: 'template-only' })
  })

  it('blockers override Choose template with an accurate message and no action', () => {
    expect(
      composerState({
        ...base,
        windowOpen: false,
        eligibility: eligibility(false, false, false, 'The customer opted out.'),
      }),
    ).toEqual({ kind: 'blocked', title: 'Reply window closed', message: 'The customer opted out.' })
    expect(
      composerState({ ...base, canSendTemplates: false, windowOpen: false, eligibility: undefined })
        .kind,
    ).toBe('blocked')
    for (const numberStatus of ['RESTRICTED', 'DISCONNECTED'] as const)
      for (const windowOpen of [true, false])
        expect(
          composerState({ ...base, numberStatus, windowOpen, eligibility: undefined }),
        ).toMatchObject({ kind: 'blocked', title: 'WhatsApp number unavailable' })
  })
})

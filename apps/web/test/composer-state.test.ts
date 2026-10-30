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
    const closed = eligibility(false, true, false)
    closed.freeform.code = 'CONVERSATION_WINDOW_CLOSED'
    expect(composerState({ ...base, windowOpen: false, eligibility: closed })).toEqual({
      kind: 'template-only',
    })
  })

  it('blockers override Choose template with an accurate message and no action', () => {
    expect(
      composerState({
        ...base,
        windowOpen: false,
        eligibility: eligibility(false, false, false, 'The customer opted out.'),
      }),
    ).toEqual({ kind: 'reply-restricted', reason: 'The customer opted out.' })
    expect(
      composerState({ ...base, canSendTemplates: false, windowOpen: false, eligibility: undefined })
        .kind,
    ).toBe('checking')
    for (const numberStatus of ['RESTRICTED', 'DISCONNECTED'] as const)
      for (const windowOpen of [true, false])
        expect(
          composerState({ ...base, numberStatus, windowOpen, eligibility: undefined }),
        ).toMatchObject({ kind: 'blocked', title: 'WhatsApp number unavailable' })
  })
  it('does not assume a reply or template is permitted while eligibility is unknown', () => {
    for (const windowOpen of [true, false])
      expect(composerState({ ...base, windowOpen, eligibility: undefined })).toEqual({
        kind: 'checking',
      })
  })
  it('honours a closed-window server verdict even when the cached expiry is still open', () => {
    const closed = eligibility(false, true, false)
    closed.freeform.code = 'CONVERSATION_WINDOW_CLOSED'
    expect(composerState({ ...base, windowOpen: true, eligibility: closed })).toEqual({
      kind: 'template-only',
    })
    expect(
      composerState({ ...base, windowOpen: false, canSendTemplates: false, eligibility: closed }),
    ).toMatchObject({ kind: 'blocked', title: 'Template messages unavailable' })
  })
})

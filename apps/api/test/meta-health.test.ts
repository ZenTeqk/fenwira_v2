import { metaHealthSchema } from '@fenwira/contracts'
import { describe, expect, it } from 'vitest'
import { toMetaHealth } from '../src/modules/whatsapp-accounts/graph-support'

// Shape returned by Meta on 2026-10-25 for a test number whose business portfolio was blocked.
const blocked = {
  can_send_message: 'BLOCKED',
  entities: [
    {
      entity_type: 'PHONE_NUMBER',
      id: '1',
      can_send_message: 'AVAILABLE',
      can_receive_call_sip: 'BLOCKED',
      errors: [
        { error_code: 138024, error_description: 'WhatsApp Business calling cannot use SIP' },
      ],
    },
    { entity_type: 'WABA', id: '2', can_send_message: 'AVAILABLE' },
    {
      entity_type: 'BUSINESS',
      id: '3',
      can_send_message: 'BLOCKED',
      errors: [
        {
          error_code: 141010,
          error_description: 'The Business has not passed business verification.',
          possible_solution:
            'Visit business settings and start or resolve the business verification request.',
        },
        {
          error_code: 131000,
          error_description: 'Your business profile is incomplete.',
          possible_solution: 'Complete your business profile in Meta Business Suite.',
        },
      ],
    },
    { entity_type: 'APP', id: '4', can_send_message: 'AVAILABLE' },
  ],
}

describe('toMetaHealth', () => {
  it('lists only the levels that block messaging, with Meta’s reason and fix', () => {
    const h = toMetaHealth(blocked, new Date('2026-10-25T16:00:00Z'))
    expect(metaHealthSchema.parse(h)).toEqual(h)
    expect(h.canSend).toBe('BLOCKED')
    expect(h.problems.map((p) => [p.level, p.code])).toEqual([
      ['Business portfolio', 141010],
      ['Business portfolio', 131000],
    ])
    expect(h.problems[0]!.solution).toMatch(/business verification/)
    // Calling-only (SIP) notices on an AVAILABLE number are not messaging problems.
    expect(JSON.stringify(h)).not.toContain('SIP')
  })

  it('healthy, limited without details, and missing data', () => {
    expect(toMetaHealth({ can_send_message: 'AVAILABLE', entities: [] }).problems).toEqual([])
    const limited = toMetaHealth({
      can_send_message: 'LIMITED',
      entities: [{ entity_type: 'WABA', can_send_message: 'LIMITED' }],
    })
    expect(limited.problems).toEqual([
      {
        level: 'WhatsApp Business Account',
        status: 'LIMITED',
        code: null,
        description: 'WhatsApp Business Account messaging is limited.',
        solution: null,
      },
    ])
    expect(toMetaHealth(undefined).canSend).toBe('UNKNOWN')
  })
})

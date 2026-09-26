import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  type EligibilityInput,
  evaluateEligibility,
  RULES,
  TEMPORARY_RULES,
} from '../src/modules/messaging/eligibility'

const now = new Date('2026-09-26T10:00:00Z')
const open = new Date(now.getTime() + 3600_000)
const closed = new Date(now.getTime() - 1000)

function input(
  over: Partial<EligibilityInput> & { consent?: Partial<EligibilityInput['contact']> },
) {
  const { consent, ...rest } = over
  return {
    purpose: 'SERVICE',
    contentType: 'TEXT',
    serviceWindowExpiresAt: open,
    now,
    ...rest,
    contact: {
      status: 'ACTIVE',
      deletedAt: null,
      marketingConsent: 'NONE',
      utilityConsent: 'NONE',
      ...consent,
    },
  } satisfies EligibilityInput
}

describe('MessageEligibilityService rules (docs/CONTACTS_AND_CONSENT.md → Eligibility)', () => {
  it('MARKETING requires recorded GRANTED marketing consent (permanent rule)', () => {
    const tpl = { purpose: 'MARKETING', contentType: 'TEMPLATE' } as const
    for (const state of ['NONE', 'REVOKED'] as const)
      expect(
        evaluateEligibility(input({ ...tpl, consent: { marketingConsent: state } })),
      ).toMatchObject({
        allowed: false,
        code: 'CONSENT_REQUIRED',
        rule: RULES.MARKETING_REQUIRES_CONSENT,
      })
    expect(
      evaluateEligibility(input({ ...tpl, consent: { marketingConsent: 'GRANTED' } })).allowed,
    ).toBe(true)
  })

  it('a template category decides over the declared purpose', () => {
    const d = evaluateEligibility(
      input({ purpose: 'UTILITY', category: 'MARKETING', contentType: 'TEMPLATE' }),
    )
    expect(d).toMatchObject({ allowed: false, rule: RULES.MARKETING_REQUIRES_CONSENT })
  })

  it('suppression: a blocked or deleted contact is never eligible, whatever the purpose', () => {
    for (const purpose of ['MARKETING', 'UTILITY', 'SERVICE'] as const) {
      expect(evaluateEligibility(input({ purpose, consent: { status: 'BLOCKED' } }))).toMatchObject(
        {
          allowed: false,
          code: 'CONTACT_BLOCKED',
          rule: RULES.SUPPRESSED_CONTACT,
        },
      )
      expect(evaluateEligibility(input({ purpose, consent: { deletedAt: now } })).allowed).toBe(
        false,
      )
    }
  })

  it('freeform content needs an open service window; templates do not', () => {
    expect(evaluateEligibility(input({ serviceWindowExpiresAt: closed }))).toMatchObject({
      allowed: false,
      code: 'CONVERSATION_WINDOW_CLOSED',
      rule: RULES.FREEFORM_NEEDS_SERVICE_WINDOW,
    })
    expect(evaluateEligibility(input({ serviceWindowExpiresAt: null })).allowed).toBe(false)
    expect(
      evaluateEligibility(
        input({ purpose: 'UTILITY', contentType: 'TEMPLATE', serviceWindowExpiresAt: null }),
      ).allowed,
    ).toBe(true)
  })

  it('checks run in a fixed order: suppression, then consent, then the window', () => {
    const d = evaluateEligibility(
      input({
        purpose: 'MARKETING',
        serviceWindowExpiresAt: closed,
        consent: { status: 'BLOCKED', marketingConsent: 'NONE' },
      }),
    )
    expect(d).toMatchObject({ rule: RULES.SUPPRESSED_CONTACT })
    expect(
      evaluateEligibility(input({ purpose: 'MARKETING', serviceWindowExpiresAt: closed })),
    ).toMatchObject({ rule: RULES.MARKETING_REQUIRES_CONSENT })
  })
})

describe('TEMPORARY eligibility rules (decision C3) — pinned until the final policy matrix', () => {
  it('lists exactly the temporary rules, so adding or removing one is a deliberate change', () => {
    expect([...TEMPORARY_RULES].sort()).toEqual([
      'TEMP_AUTHENTICATION_BLOCK_ON_REVOKED',
      'TEMP_UTILITY_BLOCK_ON_REVOKED',
    ])
    for (const r of TEMPORARY_RULES) expect(r.startsWith('TEMP_')).toBe(true)
  })

  it.each([
    ['UTILITY via purpose', { purpose: 'UTILITY' as const }, RULES.TEMP_UTILITY_BLOCK_ON_REVOKED],
    [
      'AUTHENTICATION via category',
      { purpose: 'UTILITY' as const, category: 'AUTHENTICATION' as const },
      RULES.TEMP_AUTHENTICATION_BLOCK_ON_REVOKED,
    ],
  ])('%s: blocked only when utility consent is REVOKED', (_, over, rule) => {
    const base = { ...over, contentType: 'TEMPLATE' }
    expect(
      evaluateEligibility(input({ ...base, consent: { utilityConsent: 'REVOKED' } })),
    ).toMatchObject({ allowed: false, code: 'CONSENT_REQUIRED', rule })
    for (const state of ['NONE', 'GRANTED'] as const) {
      const d = evaluateEligibility(input({ ...base, consent: { utilityConsent: state } }))
      expect(d.allowed).toBe(true)
      // The decision records that a temporary rule allowed it.
      expect(d.rules).toContain(rule)
    }
  })
})

describe('C1: no module decides eligibility except MessageEligibilityService', () => {
  it('finds no consent-state comparison outside eligibility.ts', () => {
    const root = join(__dirname, '..', 'src')
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) walk(p)
        else if (p.endsWith('.ts')) files.push(p)
      }
    }
    walk(root)
    const offenders = files
      .filter((f) => !f.endsWith(join('messaging', 'eligibility.ts')))
      .filter((f) =>
        /(marketing|utility)Consent\s*(!==|===)\s*'(GRANTED|REVOKED|NONE)'/.test(
          readFileSync(f, 'utf8'),
        ),
      )
      .map((f) => relative(root, f))
    expect(offenders).toEqual([])
  })
})

import { type TemplateComponents } from '@fenwira/contracts'
import { describe, expect, it } from 'vitest'
import {
  type AudienceContact,
  classify,
  mappingGaps,
  resolveVariables,
  skipReasonFor,
} from '../src/modules/campaigns/campaigns.core'

const contact = (over: Partial<AudienceContact> = {}): AudienceContact => ({
  id: '0192a8f0-0000-7000-8000-000000000001',
  name: 'Asha Rao',
  phoneE164: '+919876543210',
  email: 'asha@example.com',
  country: 'IN',
  status: 'ACTIVE',
  deletedAt: null,
  marketingConsent: 'NONE',
  utilityConsent: 'NONE',
  propertyValues: [
    {
      valueText: '#1042',
      valueNumber: null,
      valueDate: null,
      valueBool: null,
      definition: { key: 'order_no' },
    },
  ],
  ...over,
})
const utility: TemplateComponents = { body: { text: 'Hi {{1}}, order {{2}} ships soon.' } }

describe('campaign variable mapping (docs/CAMPAIGN_ENGINE.md → Variable mapping)', () => {
  it('resolves fields, first names, properties, statics and fallbacks', () => {
    const v = resolveVariables(
      {
        body: [
          { kind: 'FIELD', field: 'firstName' },
          { kind: 'PROPERTY', key: 'order_no' },
          { kind: 'STATIC', value: 'Diwali' },
          { kind: 'PROPERTY', key: 'missing', fallback: 'soon' },
          { kind: 'FIELD', field: 'email' },
        ],
      },
      contact(),
    )
    expect(v.body).toEqual(['Asha', '#1042', 'Diwali', 'soon', 'asha@example.com'])
    expect(
      resolveVariables(
        { body: [{ kind: 'FIELD', field: 'firstName', fallback: 'there' }] },
        contact({ name: null }),
      ).body,
    ).toEqual(['there'])
  })

  it('reports every template variable without a source', () => {
    expect(mappingGaps(utility, { body: [{ kind: 'FIELD', field: 'name' }] })).toEqual(['body.1'])
    expect(
      mappingGaps(
        { ...utility, buttons: [{ type: 'URL', text: 'Track', url: 'https://x.example/{{1}}' }] },
        {
          body: [
            { kind: 'FIELD', field: 'name' },
            { kind: 'STATIC', value: 'x' },
          ],
        },
      ),
    ).toEqual(['buttons.0.0'])
  })
})

describe('recipient classification uses the eligibility rules (no duplicated consent logic)', () => {
  const vars = { body: ['Asha', '#1'] }
  it('marketing: consent required; revoked = OPTED_OUT, never asked = NO_MARKETING_CONSENT', () => {
    const mkt = {
      category: 'MARKETING' as const,
      components: { body: { text: 'Hi {{1}}, offers are live today.' } },
    }
    expect(
      classify(contact({ marketingConsent: 'GRANTED' }), mkt, { body: ['A'] }, 'IN'),
    ).toBeNull()
    expect(classify(contact(), mkt, { body: ['A'] }, 'IN')).toBe('NO_MARKETING_CONSENT')
    expect(classify(contact({ marketingConsent: 'REVOKED' }), mkt, { body: ['A'] }, 'IN')).toBe(
      'OPTED_OUT',
    )
  })

  it('suppression, invalid phones and missing values are skipped with a reason', () => {
    const t = { category: 'UTILITY' as const, components: utility }
    expect(classify(contact(), t, vars, 'IN')).toBeNull()
    expect(classify(contact({ status: 'BLOCKED' }), t, vars, 'IN')).toBe('BLOCKED')
    expect(classify(contact({ utilityConsent: 'REVOKED' }), t, vars, 'IN')).toBe('OPTED_OUT')
    expect(classify(contact({ phoneE164: '+9112' }), t, vars, 'IN')).toBe('INVALID_PHONE')
    expect(classify(contact(), t, { body: ['Asha', ''] }, 'IN')).toBe('MISSING_VARIABLE')
  })

  it('maps send-time refusals to machine-readable skip reasons', () => {
    expect(skipReasonFor('CONTACT_BLOCKED')).toBe('BLOCKED')
    expect(skipReasonFor('TEMPLATE_VARIABLES_INVALID')).toBe('MISSING_VARIABLE')
    expect(skipReasonFor('CONSENT_REQUIRED', true)).toBe('OPTED_OUT')
    expect(skipReasonFor('CONSENT_REQUIRED', false)).toBe('NO_MARKETING_CONSENT')
    expect(skipReasonFor('SOMETHING_NEW')).toBe('OTHER_POLICY_RESTRICTION')
  })
})

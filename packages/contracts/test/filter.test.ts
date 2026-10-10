import { describe, expect, it } from 'vitest'
import { contactFilterSchema, MAX_FILTER_RULES } from '../src'

const ok = (f: unknown) => contactFilterSchema.safeParse(f).success

describe('contact filter DSL schema', () => {
  it('accepts valid field/operator/value combinations', () => {
    expect(
      ok({
        op: 'AND',
        rules: [
          { field: 'name', operator: 'CONTAINS', value: 'ravi' },
          { field: 'createdAt', operator: 'IN_LAST_DAYS', value: 30 },
          { field: 'tags', operator: 'HAS_ANY', value: ['0192a000-0000-7000-8000-000000000000'] },
          { field: 'consent.marketing', operator: 'IS', value: 'GRANTED' },
          { field: 'property.city', operator: 'EQUALS', value: 'Pune' },
          { field: 'property.score', operator: 'BETWEEN', value: [1, 5] },
          { op: 'OR', rules: [{ field: 'email', operator: 'EXISTS' }] },
        ],
      }),
    ).toBe(true)
  })

  it('rejects unknown fields, wrong operators and malformed values', () => {
    expect(ok({ op: 'AND', rules: [{ field: 'nope', operator: 'EXISTS' }] })).toBe(false)
    expect(ok({ op: 'AND', rules: [{ field: 'name', operator: 'GT', value: 1 }] })).toBe(false)
    expect(ok({ op: 'AND', rules: [{ field: 'tags', operator: 'HAS_ANY', value: ['x'] }] })).toBe(
      false,
    )
    expect(
      ok({ op: 'AND', rules: [{ field: 'consent.marketing', operator: 'IS', value: 'YES' }] }),
    ).toBe(false)
    expect(ok({ op: 'AND', rules: [{ field: 'name', operator: 'EXISTS', value: 'x' }] })).toBe(
      false,
    )
    expect(ok({ op: 'AND', rules: [{ field: 'property.Bad-Key', operator: 'EXISTS' }] })).toBe(
      false,
    )
  })

  it('limits depth to 3 and the total to 50 rules', () => {
    const deep = {
      op: 'AND',
      rules: [{ op: 'OR', rules: [{ op: 'AND', rules: [{ op: 'OR', rules: [] }] }] }],
    }
    expect(ok(deep)).toBe(false)
    const rule = { field: 'name', operator: 'EXISTS' }
    expect(ok({ op: 'AND', rules: Array(MAX_FILTER_RULES).fill(rule) })).toBe(true)
    expect(
      ok({
        op: 'AND',
        rules: [...Array(30).fill(rule), { op: 'OR', rules: Array(30).fill(rule) }],
      }),
    ).toBe(false)
  })
})

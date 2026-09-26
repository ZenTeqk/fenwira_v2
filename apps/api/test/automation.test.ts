import { describe, expect, it } from 'vitest'
import { keywordMatches, orderPlan, redact } from '../src/modules/automation'

describe('AE2 plan ordering', () => {
  const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s))
  it('orders by priority, then created_at, then id', () => {
    const flows = [
      { id: 'c', priority: 30, createdAt: at(0) },
      { id: 'b2', priority: 20, createdAt: at(5) },
      { id: 'b1', priority: 20, createdAt: at(5) },
      { id: 'a', priority: 10, createdAt: at(9) },
      { id: 'b0', priority: 20, createdAt: at(1) },
    ]
    expect(orderPlan(flows).map((f) => f.id)).toEqual(['a', 'b0', 'b1', 'b2', 'c'])
    // Deterministic regardless of input order.
    expect(orderPlan([...flows].reverse()).map((f) => f.id)).toEqual(['a', 'b0', 'b1', 'b2', 'c'])
  })
})

describe('keyword trigger matching', () => {
  const cfg = (match: 'EXACT' | 'CONTAINS' | 'STARTS_WITH', caseSensitive = false) => ({
    keywords: ['Price', 'menu'],
    match,
    caseSensitive,
  })
  it.each([
    ['EXACT', ' price ', true],
    ['EXACT', 'price please', false],
    ['CONTAINS', 'what is the PRICE?', true],
    ['STARTS_WITH', 'menu for today', true],
    ['STARTS_WITH', 'the menu', false],
  ] as const)('%s "%s" → %s', (match, text, expected) => {
    expect(keywordMatches(cfg(match), text)).toBe(expected)
  })
  it('respects case sensitivity and ignores empty text', () => {
    expect(keywordMatches(cfg('EXACT', true), 'price')).toBe(false)
    expect(keywordMatches(cfg('EXACT', true), 'Price')).toBe(true)
    expect(keywordMatches(cfg('CONTAINS'), '   ')).toBe(false)
  })
})

describe('history redaction for viewers without automations.write', () => {
  it('hides customer data and keeps identifiers and outcomes', () => {
    expect(
      redact({
        text: 'Hi Ada, your code is 1234',
        templateId: 't1',
        variables: { body: ['Ada'] },
        status: 200,
        headers: { 'X-Trace': 'abc' },
      }),
    ).toEqual({
      text: '•••',
      templateId: 't1',
      variables: { body: ['•••'] },
      status: 200,
      headers: { 'X-Trace': '•••' },
    })
  })
})

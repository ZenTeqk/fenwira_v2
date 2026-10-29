import { describe, expect, it } from 'vitest'
import { explainKeywordMatch, explainOverlap, findOverlaps, type OverlapFlow } from '../src'
describe('dry-run explanations reuse matching rules', () => {
  for (const [mode, match, miss] of [
    ['EXACT', 'price', 'price please'],
    ['WHOLE_WORD', 'what is the price?', 'prices'],
    ['CONTAINS', 'prices', 'cost'],
    ['STARTS_WITH', 'price please', 'the price'],
  ] as const) {
    it(`explains match and non-match in ${mode}`, () => {
      const config = { keywords: ['price'], match: mode, caseSensitive: false }
      expect(explainKeywordMatch(config, match)).toMatchObject({ code: 'KEYWORD_MATCHED' })
      expect(explainKeywordMatch(config, miss)).toMatchObject({ code: 'KEYWORD_NOT_MATCHED' })
      expect(explainKeywordMatch(config, miss).text).toContain(miss)
    })
  }
  it('explains the actual winning priority and keyword precedence', () => {
    const a: OverlapFlow = {
      id: 'a',
      name: 'Rule A',
      priority: 10,
      createdAt: '2026-01-01',
      trigger: { type: 'trigger.keyword', config: { keywords: ['price'], match: 'WHOLE_WORD' } },
    }
    const b: OverlapFlow = { ...a, id: 'b', name: 'Rule B', priority: 20 }
    expect(explainOverlap(findOverlaps(a, [b])[0]!, a)).toContain('priority 10 is lower')
    expect(explainOverlap(findOverlaps(a, [b])[0]!, a)).toContain('Both run one after another')
    expect(
      explainOverlap(
        findOverlaps(a, [{ ...b, trigger: { type: 'trigger.message_received', config: {} } }])[0]!,
        a,
      ),
    ).toContain('Keyword beats Message received')
  })
})

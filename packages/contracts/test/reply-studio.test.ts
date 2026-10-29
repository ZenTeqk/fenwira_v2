import { describe, expect, it } from 'vitest'
import {
  businessHoursSchema,
  businessIsOpen,
  DEFAULT_BUSINESS_HOURS,
  flowGraphSchema,
  keywordMatches,
  REPLY_PRESETS,
  replyPreset,
  validateFlowGraph,
} from '../src'
describe('Reply Studio schedules', () => {
  const schedule = businessHoursSchema.parse(DEFAULT_BUSINESS_HOURS)
  it('includes the opening boundary and excludes the closing boundary in India', () => {
    expect(businessIsOpen(schedule, new Date('2026-10-29T03:29:59Z'))).toBe(false)
    expect(businessIsOpen(schedule, new Date('2026-10-29T03:30:00Z'))).toBe(true)
    expect(businessIsOpen(schedule, new Date('2026-10-29T12:29:59Z'))).toBe(true)
    expect(businessIsOpen(schedule, new Date('2026-10-29T12:30:00Z'))).toBe(false)
  })
  it('honours closed days and holidays in the workspace timezone', () => {
    expect(businessIsOpen(schedule, new Date('2026-11-01T06:00:00Z'))).toBe(false)
    expect(
      businessIsOpen({ ...schedule, holidays: ['2026-10-29'] }, new Date('2026-10-29T06:00:00Z')),
    ).toBe(false)
  })
  it('uses actual DST offsets and rejects invalid schedules', () => {
    const london = { ...schedule, timezone: 'Europe/London' }
    expect(businessIsOpen(london, new Date('2026-06-01T08:00:00Z'))).toBe(true)
    expect(businessIsOpen(london, new Date('2026-12-01T08:00:00Z'))).toBe(false)
    expect(businessHoursSchema.safeParse({ ...schedule, timezone: 'Unknown/Zone' }).success).toBe(
      false,
    )
    expect(
      businessHoursSchema.safeParse({
        ...schedule,
        week: schedule.week.map((d) => ({ ...d, open: '18:00', close: '09:00' })),
      }).success,
    ).toBe(false)
  })
})
describe('Reply Studio keyword modes', () => {
  const cfg = { keywords: ['location', 'locatoin', 'start over'], caseSensitive: false }
  it.each([
    ['EXACT', ' LOCATION!!! ', true],
    ['EXACT', 'locatoin', true],
    ['EXACT', 'start, over', true],
    ['EXACT', 'our location', false],
    ['WHOLE_WORD', 'What is your location?', true],
    ['WHOLE_WORD', 'relocation', false],
    ['CONTAINS', 'relocation', true],
    ['STARTS_WITH', 'Location, please', true],
  ] as const)('%s handles %s', (match, text, result) =>
    expect(keywordMatches({ ...cfg, match }, text)).toBe(result),
  )
})
describe('Reply Studio starter flows', () => {
  it.each(REPLY_PRESETS)('$title compiles to the existing graph and validates', (p) => {
    const graph = replyPreset(p.id)
    expect(flowGraphSchema.safeParse(graph).success).toBe(true)
    expect(validateFlowGraph(graph)).toEqual({ valid: true, errors: [] })
  })
  it('rejects blank option labels before publish', () => {
    const graph = replyPreset('product-enquiry')
    const menu = graph.nodes.find((n) => n.id === 'category')!
    menu.config.options = [{ value: 'clothing', label: '   ' }]
    expect(validateFlowGraph(graph).errors.some((e) => e.nodeId === 'category')).toBe(true)
  })
  it('requires a fallback on questions and review confirmation before handover', () => {
    const graph = replyPreset('product-enquiry')
    expect(graph.nodes.find((n) => n.id === 'confirmed')?.config.subject).toBe('{{vars.confirm}}')
    const invalid = {
      ...graph,
      edges: graph.edges.filter((e) => e.source !== 'quantity' || e.sourceHandle !== 'error'),
    }
    expect(validateFlowGraph(invalid).errors.some((e) => e.nodeId === 'quantity')).toBe(true)
  })
})

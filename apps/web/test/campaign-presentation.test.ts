import type { Campaign } from '@fenwira/contracts'
import { describe, expect, it } from 'vitest'
import {
  campaignBodyPreview,
  isActive,
  matchesView,
  selectCampaigns,
} from '../lib/campaign-presentation'

// Minimal typed presentation fixtures: API statistics remain outside collection selection.
function campaign(index: number, status: Campaign['status'] = 'DRAFT'): Campaign {
  return {
    id: String(index),
    name: `Customer-created campaign ${String(index).padStart(3, '0')}`,
    status,
    createdAt: new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString(),
    audience: { include: [{ kind: 'CONTACTS', contactIds: [] }], exclude: [] },
    pauseReason: null,
    failureReason: null,
    phoneNumberId: null,
    phoneNumberDisplay: null,
    templateVersionId: null,
    template: null,
    variableMapping: { body: [] },
    scheduleAt: null,
    timezone: 'Asia/Kolkata',
    rateLimitPerMinute: null,
    totalRecipients: 0,
    audienceSnapshotAt: null,
    launchedAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    updatedAt: new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString(),
  }
}
const filters = {
  search: '',
  view: 'All',
  status: 'ALL',
  source: 'ALL',
  period: 'ALL',
  sort: 'NEWEST',
}
describe('API-driven campaign collection presentation', () => {
  it('handles empty, single and 200 loaded campaigns without changing the cache order', () => {
    expect(selectCampaigns([], filters)).toEqual([])
    const one = campaign(0)
    expect(selectCampaigns([one], filters)).toEqual([one])
    const rows = Array.from({ length: 200 }, (_, index) => campaign(index))
    const selected = selectCampaigns(rows, filters)
    expect(selected).toHaveLength(200)
    expect(selected[0]?.id).toBe('199')
    expect(rows[0]?.id).toBe('0')
    expect(
      selectCampaigns(rows, { ...filters, search: '  campaign 123 ' }).map((c) => c.id),
    ).toEqual(['123'])
    expect(selectCampaigns(rows, { ...filters, sort: 'NAME' })[0]?.id).toBe('0')
  })
  it('keeps all paused variants in active operations, and cancelled/failed in history', () => {
    for (const status of [
      'RUNNING',
      'PREPARING',
      'SCHEDULED',
      'PAUSED',
      'PAUSED_INSUFFICIENT_FUNDS',
      'PAUSED_TEMPLATE_UNAVAILABLE',
    ] as const) {
      expect(isActive(campaign(0, status))).toBe(true)
      expect(matchesView(campaign(0, status), 'Active')).toBe(true)
    }
    for (const status of ['DRAFT', 'COMPLETED', 'CANCELLED', 'FAILED'] as const) {
      expect(isActive(campaign(0, status))).toBe(false)
    }
  })
  it('combines real status, audience source and date filters without substituting missing data', () => {
    const now = Date.UTC(2026, 9, 7)
    const rows = [campaign(1, 'COMPLETED'), campaign(2, 'SCHEDULED')]
    expect(
      selectCampaigns(
        rows,
        { ...filters, status: 'COMPLETED', period: '7', source: 'CONTACTS' },
        now,
      ).map((c) => c.id),
    ).toEqual(['1'])
    expect(selectCampaigns(rows, { ...filters, source: 'TAGS' }, now)).toEqual([])
    expect(selectCampaigns(rows, { ...filters, period: '7' }, now + 30 * 86400000)).toEqual([])
  })
})

describe('campaignBodyPreview', () => {
  it('reads positional variables as their mapped sources', () => {
    expect(
      campaignBodyPreview('Hi {{1}}, your service is due on {{2}}.', [
        { kind: 'FIELD', field: 'firstName' },
        { kind: 'STATIC', value: '15 October' },
      ]),
    ).toBe('Hi [First name], your service is due on 15 October.')
    expect(campaignBodyPreview('Plan: {{1}}', [{ kind: 'PROPERTY', key: 'plan_tier' }])).toBe(
      'Plan: [plan_tier]',
    )
  })

  it('keeps unmapped variables as written', () => {
    expect(campaignBodyPreview('Hi {{1}} 👋', [])).toBe('Hi {{1}} 👋')
  })
})

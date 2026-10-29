import { describe, expect, it } from 'vitest'
import { DEFAULT_BUSINESS_HOURS } from '@fenwira/contracts'
import {
  businessHoursLabel,
  metricChange,
  trialDismissalDay,
  trialWording,
} from '../lib/reply-studio-presentation'
describe('Reply Studio display values', () => {
  it('uses clear trial wording for today, singular, plural and expiry', () => {
    expect(trialWording(0)).toBe('Trial ends today')
    expect(trialWording(1)).toBe('Trial ends in 1 day')
    expect(trialWording(4)).toBe('Trial ends in 4 days')
    expect(trialWording(-1)).toBe('Trial has ended')
    expect(trialDismissalDay(new Date('2026-10-29T19:00:00Z'))).toBe('2026-10-30')
  })
  it('does not invent a percentage when the previous period is empty', () => {
    expect(metricChange(10, 0)).toBe('New this week')
    expect(metricChange(0, 0)).toBe('No activity yet')
    expect(metricChange(15, 10)).toBe('+50% vs previous 7 days')
    expect(metricChange(5, 10)).toBe('-50% vs previous 7 days')
  })
  it('shows the real next opening and closing in the workspace timezone', () => {
    expect(businessHoursLabel(DEFAULT_BUSINESS_HOURS, new Date('2026-10-29T06:00:00Z'))).toEqual({
      open: true,
      detail: 'closes 6:00 PM',
    })
    expect(businessHoursLabel(DEFAULT_BUSINESS_HOURS, new Date('2026-10-30T13:00:00Z'))).toEqual({
      open: false,
      detail: 'opens Mon 9:00 AM',
    })
    expect(
      businessHoursLabel(
        { ...DEFAULT_BUSINESS_HOURS, holidays: ['2026-11-02'] },
        new Date('2026-10-30T13:00:00Z'),
      ),
    ).toEqual({ open: false, detail: 'opens Tue 9:00 AM' })
  })
})

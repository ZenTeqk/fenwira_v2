import { businessIsOpen, type BusinessHours } from '@fenwira/contracts'

/** Display-only helpers; matching and eligibility remain in the existing engine. */
export function metricChange(current: number, previous: number): string {
  if (!previous) return current ? 'New this week' : 'No change'
  const change = Math.round(((current - previous) / previous) * 100)
  return change
    ? `${change > 0 ? '+' : ''}${change}% vs previous 7 days`
    : 'No change vs previous 7 days'
}

export function businessHoursLabel(
  schedule: BusinessHours,
  now: Date,
): { open: boolean; detail: string } {
  const open = businessIsOpen(schedule, now)
  const local = new Intl.DateTimeFormat('en-CA', {
    timeZone: schedule.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const time = new Intl.DateTimeFormat('en', {
    timeZone: schedule.timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  const currentDate = local
    .formatToParts(now)
    .filter((p) => ['year', 'month', 'day'].includes(p.type))
    .map((p) => p.value)
    .join('-')
  const isOpen = (date: Date) => {
    const parts = Object.fromEntries(local.formatToParts(date).map((p) => [p.type, p.value]))
    const day =
      schedule.week[['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday!)]
    const value = `${parts.hour}:${parts.minute}`
    return (
      !!day &&
      !day.closed &&
      !schedule.holidays.includes(`${parts.year}-${parts.month}-${parts.day}`) &&
      value >= day.open &&
      value < day.close
    )
  }
  // Minute precision matches the schedule contract; reuse the formatter while finding the next boundary.
  for (let minute = 1; minute <= 8 * 1440; minute++) {
    const candidate = new Date(Math.floor(now.getTime() / 60000) * 60000 + minute * 60000)
    if (isOpen(candidate) === open) continue
    const parts = local.formatToParts(candidate)
    const date = parts
      .filter((p) => ['year', 'month', 'day'].includes(p.type))
      .map((p) => p.value)
      .join('-')
    const weekday = parts.find((p) => p.type === 'weekday')?.value
    return {
      open,
      detail: `${open ? 'closes' : 'opens'} ${date === currentDate ? '' : `${weekday} `}${time.format(candidate)}`,
    }
  }
  return { open, detail: 'View schedule' }
}

export function trialWording(days: number): string {
  if (days < 0) return 'Trial has ended'
  if (days === 0) return 'Trial ends today'
  return `Trial ends in ${days} day${days === 1 ? '' : 's'}`
}
export const trialDismissalDay = (now = new Date()) =>
  now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

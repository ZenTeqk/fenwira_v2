import { z } from 'zod'

const minute = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const day = z
  .object({ closed: z.boolean(), open: minute, close: minute })
  .refine(
    (d) => d.closed || d.open < d.close,
    'Closing time must be after opening time. Split overnight hours across days.',
  )
export const businessHoursSchema = z.object({
  timezone: z
    .string()
    .default('Asia/Kolkata')
    .refine((t) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: t })
        return true
      } catch {
        return false
      }
    }, 'Choose a valid timezone.'),
  // Monday first; closing boundary is exclusive.
  week: z.array(day).length(7),
  holidays: z.array(z.iso.date()).max(366).default([]),
})
export type BusinessHours = z.infer<typeof businessHoursSchema>
export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  timezone: 'Asia/Kolkata',
  week: Array.from({ length: 7 }, (_, i) => ({ closed: i > 4, open: '09:00', close: '18:00' })),
  holidays: [],
}
export function businessIsOpen(schedule: BusinessHours, at: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: schedule.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)
  const get = (key: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === key)?.value ?? ''
  const date = `${get('year')}-${get('month')}-${get('day')}`
  if (schedule.holidays.includes(date)) return false
  const index = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday'))
  const d = schedule.week[index]
  const time = `${get('hour')}:${get('minute')}`
  return !!d && !d.closed && time >= d.open && time < d.close
}
export const replyStudioSettingsSchema = z.object({
  kind: z.enum(['AUTO_REPLY', 'BOT_FLOW']),
  restartWords: z
    .array(z.string().trim().min(1).max(100))
    .min(1)
    .max(20)
    .default(['menu', 'restart', 'start over']),
  expiryMinutes: z.number().int().min(1).max(1440).default(1440),
  closingMessage: z.string().max(4096).default(''),
  fallbackMessage: z
    .string()
    .trim()
    .min(1)
    .max(4096)
    .default('Sorry, I could not understand that. A teammate can help with your enquiry.'),
})
export const replyReportsQuerySchema = z
  .object({
    from: z.iso.datetime(),
    to: z.iso.datetime(),
    flowId: z.uuid().optional(),
  })
  .refine(
    (q) => q.from < q.to && Date.parse(q.to) - Date.parse(q.from) <= 366 * 86400000,
    'Choose a range of up to one year.',
  )
export const replyReportCountsSchema = z.object({
  flowId: z.string(),
  name: z.string(),
  kind: z.enum(['AUTO_REPLY', 'BOT_FLOW']).optional(),
  sent: z.number().optional(),
  blocked: z.number().optional(),
  sendFailed: z.number().optional(),
  starts: z.number(),
  completions: z.number(),
  fallbacks: z.number(),
  handovers: z.number(),
  expired: z.number(),
  failures: z.number(),
})
export const replyReportSchema = z.object({
  totals: replyReportCountsSchema,
  flows: z.array(replyReportCountsSchema),
  failures: z.array(
    z.object({
      executionId: z.string(),
      flowId: z.string().optional(),
      code: z.string().optional(),
      conversationId: z.string().nullable(),
      step: z.string(),
      reason: z.string(),
      at: z.string(),
    }),
  ),
})
export type ReplyReport = z.infer<typeof replyReportSchema>

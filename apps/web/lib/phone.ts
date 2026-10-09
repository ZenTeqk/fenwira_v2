/**
 * Display grouping for stored E.164 numbers (display only: links, copies and searches keep the
 * E.164 value). Only numbering plans whose grouping is unambiguous are regrouped; any other number
 * is returned unchanged rather than guessed.
 */
export function formatPhone(e164: string): string {
  const digits = e164.replace(/^\+/, '')
  if (!/^\d+$/.test(digits) || !e164.startsWith('+')) return e164
  // India: +91 followed by a 10-digit national number → +91 98765 43210
  if (digits.length === 12 && digits.startsWith('91'))
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`
  // North America (NANP): +1 followed by 10 digits → +1 555-010-2030
  if (digits.length === 11 && digits.startsWith('1'))
    return `+1 ${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`
  return e164
}

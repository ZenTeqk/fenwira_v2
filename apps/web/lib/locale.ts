/** Countries offered at workspace creation (default IN; docs/PRODUCT.md targets India first). */
export const COUNTRIES = [
  { code: 'IN', name: 'India' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'SG', name: 'Singapore' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'US', name: 'United States' },
  { code: 'BR', name: 'Brazil' },
  { code: 'MX', name: 'Mexico' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'NG', name: 'Nigeria' },
] as const

const FALLBACK_TIMEZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Europe/London',
  'America/New_York',
  'UTC',
]

export function timezones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return FALLBACK_TIMEZONES
  }
}

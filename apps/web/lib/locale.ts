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

/**
 * Fenwira runs on India time only: every workspace uses IST, so customers never pick from the
 * world list (it confused new clients). The API default is the same zone.
 */
export const INDIA_TIMEZONE = 'Asia/Kolkata'
export const INDIA_TIMEZONE_LABEL = 'India Standard Time (IST, UTC+5:30)'

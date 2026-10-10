import { parsePhoneNumberFromString } from 'libphonenumber-js/max'

export type NormalizedPhone =
  { ok: true; e164: string; country: string | null } | { ok: false; reason: string }

/**
 * Phone → E.164 (docs/CONTACTS_AND_CONSENT.md → Contact identity). Numbers without a "+" are read
 * with the tenant's default country as the region hint; anything libphonenumber's full metadata
 * doesn't consider valid is rejected with a reason the user can act on.
 */
export function normalizePhone(input: string, defaultCountry: string): NormalizedPhone {
  const raw = input.trim()
  if (!raw) return { ok: false, reason: 'The phone number is empty.' }
  // "00" international prefix and bare digits of a full international number are common in CSVs.
  const candidate = raw.startsWith('00') ? `+${raw.slice(2)}` : raw
  const parsed = parsePhoneNumberFromString(candidate, defaultCountry.toUpperCase() as never)
  if (!parsed) return { ok: false, reason: 'This is not a phone number.' }
  if (!parsed.isValid())
    return {
      ok: false,
      reason: parsed.country
        ? `Not a valid ${parsed.country} number.`
        : 'Not a valid number. Include the country code, for example +91.',
    }
  return { ok: true, e164: parsed.number, country: parsed.country ?? null }
}

/** ISO country of an E.164 number (for per-country pricing), or null. */
export function countryOf(e164: string): string | null {
  return parsePhoneNumberFromString(e164)?.country ?? null
}

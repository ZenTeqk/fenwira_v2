import { type ImportTarget } from '@fenwira/contracts'
import { normalizePhone } from '../../../core/phone'
import { coercePropertyValue, type DefinitionRow, type StoredValue } from '../properties'

export type RowError = { field: string | null; code: string; message: string }
export type ValidRow = {
  phoneE164: string
  name?: string
  email?: string
  language?: string
  country?: string
  tags: string[]
  consent?: 'GRANTED' | 'REVOKED'
  properties: Array<{ definitionId: string; value: StoredValue }>
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const LANG_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/
const GRANTED = new Set(['yes', 'y', 'true', '1', 'granted', 'opt-in', 'optin'])
const REVOKED = new Set(['no', 'n', 'false', '0', 'revoked', 'opt-out', 'optout'])

/** Header suggestions (docs/CONTACTS_AND_CONSENT.md → CSV import: auto-suggest by similarity). */
const SYNONYMS: Array<[ImportTarget, string[]]> = [
  [
    'phone',
    [
      'phone',
      'mobile',
      'whatsapp',
      'number',
      'phonenumber',
      'mobilenumber',
      'cell',
      'msisdn',
      'contactnumber',
      'whatsappnumber',
    ],
  ],
  ['name', ['name', 'fullname', 'customername', 'contactname', 'customer']],
  ['email', ['email', 'emailaddress', 'mail', 'emailid']],
  ['language', ['language', 'lang', 'locale']],
  ['country', ['country', 'countrycode']],
  ['tags', ['tags', 'tag', 'labels', 'label', 'groups']],
  ['consent.marketing', ['consent', 'marketingconsent', 'optin', 'marketing', 'subscribed']],
]
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

export function suggestMapping(
  headers: string[],
  defs: DefinitionRow[],
): Record<string, ImportTarget> {
  const used = new Set<ImportTarget>()
  const out: Record<string, ImportTarget> = {}
  for (const header of headers) {
    const h = squash(header)
    let target: ImportTarget = 'ignore'
    const core = SYNONYMS.find(([t, words]) => !used.has(t) && words.includes(h))
    if (core) target = core[0]
    else {
      const def = defs.find(
        (d) =>
          !d.archivedAt &&
          (squash(d.key) === h || squash(d.label) === h) &&
          !used.has(`property.${d.key}`),
      )
      if (def) target = `property.${def.key}`
    }
    if (target !== 'ignore') used.add(target)
    out[header] = target
  }
  return out
}

/** Per-row validation and normalization for one import's mapping. */
export class RowValidator {
  private readonly byKey: Map<string, DefinitionRow>

  constructor(
    private readonly mapping: Record<string, ImportTarget>,
    defs: DefinitionRow[],
    private readonly defaultCountry: string,
    private readonly defaultConsent?: 'GRANTED' | 'REVOKED',
  ) {
    this.byKey = new Map(defs.map((d) => [d.key, d]))
  }

  validate(record: Record<string, string>): { errors: RowError[]; row?: ValidRow } {
    const errors: RowError[] = []
    const row: ValidRow = { phoneE164: '', tags: [], properties: [] }
    let phoneSeen = false
    for (const [header, target] of Object.entries(this.mapping)) {
      if (target === 'ignore') continue
      const value = (record[header] ?? '').trim()
      switch (target) {
        case 'phone': {
          phoneSeen = true
          if (!value) {
            errors.push({
              field: header,
              code: 'MISSING_PHONE',
              message: 'The phone number is empty.',
            })
            break
          }
          const p = normalizePhone(value, this.defaultCountry)
          if (!p.ok) errors.push({ field: header, code: 'INVALID_PHONE', message: p.reason })
          else {
            row.phoneE164 = p.e164
            row.country ??= p.country ?? undefined
          }
          break
        }
        case 'name':
          if (value.length > 120)
            errors.push({
              field: header,
              code: 'TOO_LONG',
              message: 'Names can be up to 120 characters.',
            })
          else if (value) row.name = value
          break
        case 'email':
          if (value && !EMAIL_RE.test(value))
            errors.push({
              field: header,
              code: 'INVALID_EMAIL',
              message: 'Not a valid email address.',
            })
          else if (value) row.email = value.toLowerCase()
          break
        case 'language':
          if (value && !LANG_RE.test(value))
            errors.push({
              field: header,
              code: 'INVALID_LANGUAGE',
              message: 'Use a language code such as en or pt-BR.',
            })
          else if (value) row.language = value
          break
        case 'country':
          if (value && !/^[A-Za-z]{2}$/.test(value))
            errors.push({
              field: header,
              code: 'INVALID_COUNTRY',
              message: 'Use a two-letter country code such as IN.',
            })
          else if (value) row.country = value.toUpperCase()
          break
        case 'tags':
          row.tags = value
            .split(/[;,]/)
            .map((t) => t.trim())
            .filter(Boolean)
          if (row.tags.some((t) => t.length > 40))
            errors.push({
              field: header,
              code: 'TAG_TOO_LONG',
              message: 'Tags can be up to 40 characters.',
            })
          break
        case 'consent.marketing': {
          const v = value.toLowerCase()
          if (!v) break
          if (GRANTED.has(v)) row.consent = 'GRANTED'
          else if (REVOKED.has(v)) row.consent = 'REVOKED'
          else errors.push({ field: header, code: 'INVALID_CONSENT', message: 'Use yes or no.' })
          break
        }
        default: {
          const def = this.byKey.get(target.slice(9))
          if (!def) break
          if (!value) {
            if (def.required)
              errors.push({ field: header, code: 'REQUIRED', message: `${def.label} is required.` })
            break
          }
          const coerced = coercePropertyValue(def, value)
          if ('error' in coerced)
            errors.push({ field: header, code: 'INVALID_PROPERTY', message: coerced.error })
          else if (coerced.value)
            row.properties.push({ definitionId: def.id, value: coerced.value })
        }
      }
    }
    if (!phoneSeen)
      errors.push({ field: null, code: 'MISSING_PHONE', message: 'No column is mapped to phone.' })
    row.consent ??= this.defaultConsent
    return errors.length ? { errors } : { errors, row }
  }
}

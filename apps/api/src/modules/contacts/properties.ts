import { type PropertyValue } from '@fenwira/contracts'
import { Prisma } from '@fenwira/database'

export type DefinitionRow = {
  id: string
  key: string
  label: string
  type: 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN' | 'SELECT'
  options: Prisma.JsonValue
  required: boolean
  archivedAt: Date | null
}
export type StoredValue = {
  valueText: string | null
  valueNumber: Prisma.Decimal | null
  valueDate: Date | null
  valueBool: boolean | null
}

const TRUE = new Set(['true', 'yes', 'y', '1'])
const FALSE = new Set(['false', 'no', 'n', '0'])

/**
 * API/CSV value → typed column for a property definition. Strings are accepted for every type
 * (imports are all text); `null` or '' clears the value. Returns an error message when invalid.
 */
export function coercePropertyValue(
  def: DefinitionRow,
  raw: unknown,
): { value: StoredValue | null } | { error: string } {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === ''))
    return { value: null }
  const empty: StoredValue = {
    valueText: null,
    valueNumber: null,
    valueDate: null,
    valueBool: null,
  }
  const s = typeof raw === 'string' ? raw.trim() : raw
  switch (def.type) {
    case 'TEXT':
      if (typeof s !== 'string' && typeof s !== 'number')
        return { error: `${def.label} must be text.` }
      if (String(s).length > 1000) return { error: `${def.label} is too long (max 1000).` }
      return { value: { ...empty, valueText: String(s) } }
    case 'NUMBER': {
      const n = typeof s === 'number' ? s : Number(String(s).replace(/,/g, ''))
      if (!Number.isFinite(n)) return { error: `${def.label} must be a number.` }
      return { value: { ...empty, valueNumber: new Prisma.Decimal(n) } }
    }
    case 'DATE': {
      const text = String(s)
      if (!/^\d{4}-\d{2}-\d{2}/.test(text))
        return { error: `${def.label} must be a date (YYYY-MM-DD).` }
      const d = new Date(`${text.slice(0, 10)}T00:00:00.000Z`)
      if (Number.isNaN(d.getTime())) return { error: `${def.label} must be a valid date.` }
      return { value: { ...empty, valueDate: d } }
    }
    case 'BOOLEAN': {
      if (typeof s === 'boolean') return { value: { ...empty, valueBool: s } }
      const t = String(s).toLowerCase()
      if (TRUE.has(t)) return { value: { ...empty, valueBool: true } }
      if (FALSE.has(t)) return { value: { ...empty, valueBool: false } }
      return { error: `${def.label} must be yes or no.` }
    }
    case 'SELECT': {
      const options = (def.options as string[] | null) ?? []
      const match = options.find((o) => o.toLowerCase() === String(s).toLowerCase())
      if (!match) return { error: `${def.label} must be one of: ${options.join(', ')}.` }
      return { value: { ...empty, valueText: match } }
    }
  }
}

/** Stored value → API shape (dates as YYYY-MM-DD). */
export function propertyOut(type: DefinitionRow['type'], v: StoredValue): PropertyValue {
  switch (type) {
    case 'NUMBER':
      return v.valueNumber === null ? null : Number(v.valueNumber)
    case 'DATE':
      return v.valueDate ? v.valueDate.toISOString().slice(0, 10) : null
    case 'BOOLEAN':
      return v.valueBool
    default:
      return v.valueText
  }
}

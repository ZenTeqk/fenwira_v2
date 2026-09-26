import { z } from 'zod'

/**
 * Contact filter DSL (docs/CONTACTS_AND_CONSENT.md → Filter DSL). One definition shared by the
 * contact list, counts, segments, bulk actions, exports and (Phase 9) campaign audiences. The
 * schema checks field/operator/value combinations; `property.*` operators are re-checked against
 * the property's type when the filter is compiled (only the server knows the type).
 */
export const CORE_FIELDS = {
  name: 'text',
  phone: 'text',
  email: 'text',
  language: 'text',
  country: 'text',
  source: 'enum',
  status: 'enum',
  ownerId: 'enum',
  createdAt: 'date',
  lastInboundAt: 'date',
  tags: 'tags',
  'consent.marketing': 'consent',
  'consent.utility': 'consent',
  segment: 'segment',
} as const
export type CoreField = keyof typeof CORE_FIELDS
export type FieldKind = (typeof CORE_FIELDS)[CoreField] | 'number' | 'boolean' | 'select'

export const OPERATORS_BY_KIND = {
  text: ['EQUALS', 'NOT_EQUALS', 'CONTAINS', 'NOT_CONTAINS', 'STARTS_WITH', 'EXISTS', 'NOT_EXISTS'],
  number: ['EQUALS', 'NOT_EQUALS', 'GT', 'GTE', 'LT', 'LTE', 'BETWEEN', 'EXISTS', 'NOT_EXISTS'],
  date: ['BEFORE', 'AFTER', 'BETWEEN', 'IN_LAST_DAYS', 'NOT_IN_LAST_DAYS', 'EXISTS', 'NOT_EXISTS'],
  boolean: ['IS_TRUE', 'IS_FALSE', 'EXISTS', 'NOT_EXISTS'],
  select: ['IN', 'NOT_IN', 'EXISTS', 'NOT_EXISTS'],
  enum: ['IN', 'NOT_IN', 'EXISTS', 'NOT_EXISTS'],
  tags: ['HAS_ANY', 'HAS_ALL', 'HAS_NONE'],
  consent: ['IS'],
  segment: ['IN', 'NOT_IN'],
} as const satisfies Record<FieldKind, readonly string[]>

export const OPERATORS = [
  ...new Set(Object.values(OPERATORS_BY_KIND).flat()),
] as unknown as readonly Operator[]
export type Operator = (typeof OPERATORS_BY_KIND)[FieldKind][number]

export const CONSENT_STATES = ['GRANTED', 'REVOKED', 'NONE'] as const
export const MAX_FILTER_DEPTH = 3
export const MAX_FILTER_RULES = 50
export const PROPERTY_KEY_RE = /^[a-z][a-z0-9_]{0,62}$/

const isoDate = z.iso.datetime({ offset: true }).or(z.iso.date())
const text = z.string().max(500)
const uuid = z.uuid()

/** Value shape each operator requires (`kind` narrows EQUALS / BETWEEN / IN). */
function valueSchema(operator: Operator, kind: FieldKind | 'property'): z.ZodType | null {
  switch (operator) {
    case 'EXISTS':
    case 'NOT_EXISTS':
    case 'IS_TRUE':
    case 'IS_FALSE':
      return null
    case 'EQUALS':
    case 'NOT_EQUALS':
      return kind === 'number'
        ? z.number()
        : kind === 'property'
          ? z.union([text, z.number()])
          : text
    case 'CONTAINS':
    case 'NOT_CONTAINS':
    case 'STARTS_WITH':
      return text.min(1)
    case 'GT':
    case 'GTE':
    case 'LT':
    case 'LTE':
      return z.number()
    case 'BEFORE':
    case 'AFTER':
      return isoDate
    case 'BETWEEN':
      return kind === 'date'
        ? z.tuple([isoDate, isoDate])
        : kind === 'number'
          ? z.tuple([z.number(), z.number()])
          : z.union([z.tuple([z.number(), z.number()]), z.tuple([isoDate, isoDate])])
    case 'IN_LAST_DAYS':
    case 'NOT_IN_LAST_DAYS':
      return z.number().int().min(1).max(3650)
    case 'IN':
    case 'NOT_IN':
      return kind === 'segment' ? uuid : z.array(text).min(1).max(100)
    case 'HAS_ANY':
    case 'HAS_ALL':
    case 'HAS_NONE':
      return z.array(uuid).min(1).max(50)
    case 'IS':
      return z.enum(CONSENT_STATES)
  }
}

export type FilterRule = { field: string; operator: Operator; value?: unknown }
export type ContactFilter = { op: 'AND' | 'OR'; rules: Array<FilterRule | ContactFilter> }

export const isFilterGroup = (r: FilterRule | ContactFilter): r is ContactFilter => 'rules' in r

/** Kind of a core field, or 'property' for `property.<key>`, or null when unknown. */
export function fieldKind(field: string): FieldKind | 'property' | null {
  if (field.startsWith('property.')) return PROPERTY_KEY_RE.test(field.slice(9)) ? 'property' : null
  return (CORE_FIELDS as Record<string, FieldKind>)[field] ?? null
}

export const ALL_PROPERTY_OPERATORS = [
  ...new Set([
    ...OPERATORS_BY_KIND.text,
    ...OPERATORS_BY_KIND.number,
    ...OPERATORS_BY_KIND.date,
    ...OPERATORS_BY_KIND.boolean,
    ...OPERATORS_BY_KIND.select,
  ]),
] as readonly Operator[]

const ruleSchema = z
  .object({ field: z.string().max(80), operator: z.string(), value: z.unknown().optional() })
  .superRefine((rule, ctx) => {
    const kind = fieldKind(rule.field)
    if (!kind) {
      ctx.addIssue({ code: 'custom', path: ['field'], message: `Unknown field "${rule.field}".` })
      return
    }
    const allowed: readonly string[] =
      kind === 'property' ? ALL_PROPERTY_OPERATORS : OPERATORS_BY_KIND[kind]
    if (!allowed.includes(rule.operator)) {
      ctx.addIssue({
        code: 'custom',
        path: ['operator'],
        message: `"${rule.operator}" can't be used with ${rule.field}.`,
      })
      return
    }
    const schema = valueSchema(rule.operator as Operator, kind)
    if (!schema) {
      if (rule.value !== undefined && rule.value !== null)
        ctx.addIssue({ code: 'custom', path: ['value'], message: 'This operator takes no value.' })
      return
    }
    const parsed = schema.safeParse(rule.value)
    if (!parsed.success)
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'The value is not valid for this operator.',
      })
  })
  .transform((r) => r as FilterRule)

type FilterInput = { op: 'AND' | 'OR'; rules: Array<unknown> }
export const contactFilterSchema: z.ZodType<ContactFilter> = z
  .lazy(() =>
    z.object({
      op: z.enum(['AND', 'OR']),
      rules: z.array(z.union([contactFilterSchema, ruleSchema])).max(MAX_FILTER_RULES),
    }),
  )
  .superRefine((filter, ctx) => {
    let rules = 0
    let depth = 0
    const walk = (f: FilterInput, level: number) => {
      depth = Math.max(depth, level)
      for (const r of f.rules as Array<FilterRule | ContactFilter>) {
        if (isFilterGroup(r)) walk(r, level + 1)
        else rules += 1
      }
    }
    walk(filter as FilterInput, 1)
    if (depth > MAX_FILTER_DEPTH)
      ctx.addIssue({
        code: 'custom',
        message: `Filters can nest at most ${MAX_FILTER_DEPTH} levels.`,
      })
    if (rules > MAX_FILTER_RULES)
      ctx.addIssue({
        code: 'custom',
        message: `Filters can have at most ${MAX_FILTER_RULES} rules.`,
      })
  })
  // A stable name for the recursive schema in generated docs (docs/openapi.json).
  .meta({ id: 'ContactFilter' }) as z.ZodType<ContactFilter>

export const EMPTY_FILTER: ContactFilter = { op: 'AND', rules: [] }

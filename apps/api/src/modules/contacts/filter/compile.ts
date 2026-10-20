import {
  type ContactFilter,
  fieldKind,
  type FieldKind,
  type FilterRule,
  isFilterGroup,
  OPERATORS_BY_KIND,
} from '@fenwira/contracts'
import { type Prisma, type TenantTx } from '@fenwira/database'
import { AppError } from '../../../core/http/app-error'
import { likeLiteral } from '../../../core/database/like'

/**
 * The one contact-filter compiler (docs/CONTACTS_AND_CONSENT.md → Filter DSL): DSL → Prisma
 * `where`. Used by the list, counts, segments, bulk actions, exports and campaign audiences; no
 * other code builds contact queries from user input. Negative operators (NOT_EQUALS, NOT_IN, …)
 * include contacts that have no value, so `A` and `NOT A` always partition the contacts.
 */
type Where = Prisma.ContactWhereInput
type Definition = {
  id: string
  key: string
  type: 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN' | 'SELECT'
}

const TEXT_COLUMNS = {
  name: 'name',
  phone: 'phoneE164',
  email: 'email',
  language: 'language',
  country: 'country',
} as const
const ENUMS: Record<string, readonly string[]> = {
  source: ['INBOUND', 'MANUAL', 'IMPORT', 'API', 'CAMPAIGN', 'AUTOMATION'],
  status: ['ACTIVE', 'BLOCKED'],
}
const DAY_MS = 24 * 3600 * 1000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NOTHING: Where = { id: { in: [] } }
/**
 * "Match every live contact". Never use `{}` for this: Prisma drops empty objects inside OR, so
 * `OR [{}, X]` would silently mean `X` (found by the property-based test).
 */
const EVERYTHING: Where = { deletedAt: null }
const KIND_OF: Record<Definition['type'], FieldKind> = {
  TEXT: 'text',
  NUMBER: 'number',
  DATE: 'date',
  BOOLEAN: 'boolean',
  SELECT: 'select',
}

const invalid = (path: string, message: string) =>
  AppError.validation([{ path, code: 'invalid_filter', message }], 'The filter is not valid.')

export type CompileContext = { now?: Date; allowSegments?: boolean }

export class FilterCompiler {
  private definitions = new Map<string, Definition>()
  private readonly now: Date

  constructor(
    private readonly tx: TenantTx,
    private readonly ctx: CompileContext = {},
  ) {
    this.now = ctx.now ?? new Date()
  }

  /** Where for live (non-deleted) contacts matching `filter` (and the quick search `q`). */
  async compile(filter: ContactFilter | undefined, q?: string): Promise<Where> {
    const and: Where[] = [{ deletedAt: null }]
    if (filter) {
      await this.loadDefinitions(filter)
      and.push(await this.group(filter, 'filter'))
    }
    if (q) {
      const digits = q.replace(/[^\d]/g, '')
      and.push({
        OR: [
          { name: { contains: likeLiteral(q), mode: 'insensitive' } },
          { email: { contains: likeLiteral(q), mode: 'insensitive' } },
          { waProfileName: { contains: likeLiteral(q), mode: 'insensitive' } },
          ...(digits.length >= 3 ? [{ phoneE164: { contains: digits } }] : []),
        ],
      })
    }
    return { AND: and }
  }

  private async loadDefinitions(filter: ContactFilter): Promise<void> {
    const keys = new Set<string>()
    const walk = (f: ContactFilter) => {
      for (const r of f.rules)
        if (isFilterGroup(r)) walk(r)
        else if (r.field.startsWith('property.')) keys.add(r.field.slice(9))
    }
    walk(filter)
    if (!keys.size) return
    const defs = await this.tx.contactPropertyDefinition.findMany({
      where: { key: { in: [...keys] } },
    })
    for (const d of defs) this.definitions.set(d.key, d)
  }

  private async group(f: ContactFilter, path: string): Promise<Where> {
    const parts: Where[] = []
    for (const [i, r] of f.rules.entries())
      parts.push(
        isFilterGroup(r)
          ? await this.group(r, `${path}.rules.${i}`)
          : await this.rule(r, `${path}.rules.${i}`),
      )
    if (!parts.length) return EVERYTHING
    return f.op === 'AND' ? { AND: parts } : { OR: parts }
  }

  private async rule(r: FilterRule, path: string): Promise<Where> {
    const kind = fieldKind(r.field)
    if (kind === 'property') return this.property(r, path)
    if (kind === null) throw invalid(path, `Unknown field "${r.field}".`)
    if (!(OPERATORS_BY_KIND[kind] as readonly string[]).includes(r.operator))
      throw invalid(path, `"${r.operator}" can't be used with ${r.field}.`)
    switch (kind) {
      case 'text':
        return textClause(TEXT_COLUMNS[r.field as keyof typeof TEXT_COLUMNS], r)
      case 'enum':
        return this.enumClause(r, path)
      case 'date':
        return dateClause(r.field as 'createdAt' | 'lastInboundAt', r, this.now)
      case 'tags': {
        const ids = r.value as string[]
        if (r.operator === 'HAS_ANY') return { tags: { some: { tagId: { in: ids } } } }
        if (r.operator === 'HAS_NONE') return { tags: { none: { tagId: { in: ids } } } }
        return { AND: ids.map((tagId) => ({ tags: { some: { tagId } } })) }
      }
      case 'consent':
        return {
          [r.field === 'consent.marketing' ? 'marketingConsent' : 'utilityConsent']: r.value,
        } as Where
      case 'segment':
        return this.segment(r, path)
      default:
        throw invalid(path, `Unsupported field "${r.field}".`)
    }
  }

  private enumClause(r: FilterRule, path: string): Where {
    const column = r.field as 'source' | 'status' | 'ownerId'
    if (r.operator === 'EXISTS')
      return column === 'ownerId' ? { ownerId: { not: null } } : EVERYTHING
    if (r.operator === 'NOT_EXISTS') return column === 'ownerId' ? { ownerId: null } : NOTHING
    const values = r.value as string[]
    const allowed = ENUMS[column]
    for (const v of values)
      if (allowed ? !allowed.includes(v) : !UUID_RE.test(v))
        throw invalid(path, `"${v}" is not a valid ${column}.`)
    if (r.operator === 'IN') return { [column]: { in: values } } as Where
    return column === 'ownerId'
      ? { OR: [{ ownerId: null }, { ownerId: { notIn: values } }] }
      : ({ [column]: { notIn: values } } as Where)
  }

  private async segment(r: FilterRule, path: string): Promise<Where> {
    if (this.ctx.allowSegments === false)
      throw invalid(path, 'A segment used inside another segment filter cannot reference segments.')
    const segment = await this.tx.segment.findFirst({
      where: { id: r.value as string, deletedAt: null },
    })
    if (!segment) throw invalid(path, 'That segment no longer exists.')
    const inner = new FilterCompiler(this.tx, { now: this.now, allowSegments: false })
    const where = await inner.compile(segment.filter as unknown as ContactFilter)
    return r.operator === 'IN' ? where : { NOT: where }
  }

  private property(r: FilterRule, path: string): Where {
    const key = r.field.slice(9)
    const def = this.definitions.get(key)
    if (!def) throw invalid(path, `There is no contact property "${key}".`)
    const kind = KIND_OF[def.type]
    if (!(OPERATORS_BY_KIND[kind] as readonly string[]).includes(r.operator))
      throw invalid(
        path,
        `"${r.operator}" can't be used with a ${def.type.toLowerCase()} property.`,
      )
    const has = (cond: Prisma.ContactPropertyValueWhereInput): Where => ({
      propertyValues: { some: { definitionId: def.id, ...cond } },
    })
    const not = (cond: Prisma.ContactPropertyValueWhereInput): Where => ({ NOT: has(cond) })
    if (r.operator === 'EXISTS') return has({})
    if (r.operator === 'NOT_EXISTS') return { propertyValues: { none: { definitionId: def.id } } }
    const v = r.value
    switch (kind) {
      case 'text': {
        const s = String(v)
        const mode = 'insensitive' as const
        if (r.operator === 'EQUALS') return has({ valueText: { equals: likeLiteral(s), mode } })
        if (r.operator === 'NOT_EQUALS') return not({ valueText: { equals: likeLiteral(s), mode } })
        if (r.operator === 'CONTAINS') return has({ valueText: { contains: likeLiteral(s), mode } })
        if (r.operator === 'NOT_CONTAINS')
          return not({ valueText: { contains: likeLiteral(s), mode } })
        return has({ valueText: { startsWith: likeLiteral(s), mode } })
      }
      case 'select': {
        if (!Array.isArray(v)) throw invalid(path, 'Choose at least one option.')
        return r.operator === 'IN'
          ? has({ valueText: { in: v as string[] } })
          : not({ valueText: { in: v as string[] } })
      }
      case 'boolean':
        return has({ valueBool: r.operator === 'IS_TRUE' })
      case 'number': {
        const num = (x: unknown) => {
          if (typeof x !== 'number' || !Number.isFinite(x)) throw invalid(path, 'Enter a number.')
          return x
        }
        switch (r.operator) {
          case 'EQUALS':
            return has({ valueNumber: { equals: num(v) } })
          case 'NOT_EQUALS':
            return not({ valueNumber: { equals: num(v) } })
          case 'GT':
            return has({ valueNumber: { gt: num(v) } })
          case 'GTE':
            return has({ valueNumber: { gte: num(v) } })
          case 'LT':
            return has({ valueNumber: { lt: num(v) } })
          case 'LTE':
            return has({ valueNumber: { lte: num(v) } })
          default: {
            const [a, b] = v as [unknown, unknown]
            return has({ valueNumber: { gte: num(a), lte: num(b) } })
          }
        }
      }
      case 'date': {
        const cond = dateCondition(r, this.now, path)
        return cond.negate ? not({ valueDate: cond.where }) : has({ valueDate: cond.where })
      }
      default:
        throw invalid(path, 'Unsupported property type.')
    }
  }
}

function textClause(column: string, r: FilterRule): Where {
  const mode = 'insensitive' as const
  const is = (cond: object): Where => ({ [column]: cond }) as Where
  const missing = is({ equals: null })
  switch (r.operator) {
    case 'EQUALS':
      return is({ equals: likeLiteral(String(r.value)), mode })
    case 'NOT_EQUALS':
      return { OR: [missing, { NOT: is({ equals: likeLiteral(String(r.value)), mode }) }] }
    case 'CONTAINS':
      return is({ contains: likeLiteral(String(r.value)), mode })
    case 'NOT_CONTAINS':
      return { OR: [missing, { NOT: is({ contains: likeLiteral(String(r.value)), mode }) }] }
    case 'STARTS_WITH':
      return is({ startsWith: likeLiteral(String(r.value)), mode })
    case 'EXISTS':
      return is({ not: null })
    default:
      return missing
  }
}

function toDate(v: unknown, path: string): Date {
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) throw invalid(path, 'Enter a valid date.')
  return d
}

/** Date comparison; `negate` for NOT_IN_LAST_DAYS (which also matches contacts with no date). */
function dateCondition(
  r: FilterRule,
  now: Date,
  path: string,
): { where: Prisma.DateTimeNullableFilter; negate?: boolean } {
  switch (r.operator) {
    case 'BEFORE':
      return { where: { lt: toDate(r.value, path) } }
    case 'AFTER':
      return { where: { gt: toDate(r.value, path) } }
    case 'BETWEEN': {
      const [a, b] = r.value as [unknown, unknown]
      return { where: { gte: toDate(a, path), lte: toDate(b, path) } }
    }
    case 'IN_LAST_DAYS':
      return { where: { gte: new Date(now.getTime() - Number(r.value) * DAY_MS) } }
    case 'NOT_IN_LAST_DAYS':
      return { where: { gte: new Date(now.getTime() - Number(r.value) * DAY_MS) }, negate: true }
    default:
      throw invalid(path, `Unsupported date operator "${r.operator}".`)
  }
}

function dateClause(column: 'createdAt' | 'lastInboundAt', r: FilterRule, now: Date): Where {
  if (r.operator === 'EXISTS')
    return column === 'createdAt' ? EVERYTHING : { lastInboundAt: { not: null } }
  if (r.operator === 'NOT_EXISTS') return column === 'createdAt' ? NOTHING : { lastInboundAt: null }
  const cond = dateCondition(r, now, 'filter')
  if (!cond.negate) return { [column]: cond.where } as Where
  // "Not in the last N days" also matches contacts that never had the date.
  const before = { [column]: { lt: cond.where.gte } } as Where
  return column === 'createdAt' ? before : { OR: [{ lastInboundAt: null }, before] }
}

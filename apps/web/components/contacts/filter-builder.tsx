'use client'

import {
  type ContactFilter,
  type FieldKind,
  type FilterRule,
  isFilterGroup,
  type Operator,
  OPERATORS_BY_KIND,
  type PropertyDefinition,
} from '@fenwira/contracts'
import {
  Button,
  cn,
  Input,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@fenwira/ui'
import { Plus, X } from 'lucide-react'
import { SOURCE_LABEL, useProperties, useSegments, useTags } from '@/lib/contacts'

type FieldMeta = {
  field: string
  label: string
  kind: FieldKind
  options?: Array<{ value: string; label: string }>
}

const CORE: FieldMeta[] = [
  { field: 'name', label: 'Name', kind: 'text' },
  { field: 'phone', label: 'Phone', kind: 'text' },
  { field: 'email', label: 'Email', kind: 'text' },
  { field: 'language', label: 'Language', kind: 'text' },
  { field: 'country', label: 'Country', kind: 'text' },
  {
    field: 'source',
    label: 'Source',
    kind: 'enum',
    options: Object.entries(SOURCE_LABEL).map(([value, label]) => ({ value, label })),
  },
  {
    field: 'status',
    label: 'Status',
    kind: 'enum',
    options: [
      { value: 'ACTIVE', label: 'Active' },
      { value: 'BLOCKED', label: 'Blocked' },
    ],
  },
  { field: 'createdAt', label: 'Created', kind: 'date' },
  { field: 'lastInboundAt', label: 'Last message from contact', kind: 'date' },
  { field: 'tags', label: 'Tags', kind: 'tags' },
  { field: 'consent.marketing', label: 'Marketing consent', kind: 'consent' },
  { field: 'consent.utility', label: 'Utility consent', kind: 'consent' },
  { field: 'segment', label: 'Segment', kind: 'segment' },
]

const OPERATOR_LABEL: Record<Operator, string> = {
  EQUALS: 'is',
  NOT_EQUALS: 'is not',
  CONTAINS: 'contains',
  NOT_CONTAINS: "doesn't contain",
  STARTS_WITH: 'starts with',
  EXISTS: 'is set',
  NOT_EXISTS: 'is empty',
  GT: 'is greater than',
  GTE: 'is at least',
  LT: 'is less than',
  LTE: 'is at most',
  BETWEEN: 'is between',
  BEFORE: 'is before',
  AFTER: 'is after',
  IN_LAST_DAYS: 'in the last … days',
  NOT_IN_LAST_DAYS: 'not in the last … days',
  IS_TRUE: 'is yes',
  IS_FALSE: 'is no',
  IN: 'is any of',
  NOT_IN: 'is none of',
  HAS_ANY: 'has any of',
  HAS_ALL: 'has all of',
  HAS_NONE: 'has none of',
  IS: 'is',
}

const PROPERTY_KIND: Record<PropertyDefinition['type'], FieldKind> = {
  TEXT: 'text',
  NUMBER: 'number',
  DATE: 'date',
  BOOLEAN: 'boolean',
  SELECT: 'select',
}

const NO_VALUE = new Set<Operator>(['EXISTS', 'NOT_EXISTS', 'IS_TRUE', 'IS_FALSE'])

/** Rules whose value is filled in; incomplete rules are left out of the query. */
function isComplete(r: FilterRule): boolean {
  if (NO_VALUE.has(r.operator)) return true
  const v = r.value
  if (Array.isArray(v))
    return (
      v.length > 0 &&
      v.every((x) => x !== '' && x !== null && !(typeof x === 'number' && Number.isNaN(x)))
    )
  return v !== undefined && v !== null && v !== '' && !(typeof v === 'number' && Number.isNaN(v))
}

export function completeFilter(f: ContactFilter): ContactFilter {
  const rules: ContactFilter['rules'] = []
  for (const r of f.rules) {
    if (isFilterGroup(r)) {
      const g = completeFilter(r)
      if (g.rules.length) rules.push(g)
    } else if (isComplete(r)) rules.push(r)
  }
  return { op: f.op, rules }
}

export const countRules = (f: ContactFilter): number =>
  f.rules.reduce((n, r) => n + (isFilterGroup(r) ? countRules(r) : 1), 0)

function useFields(): FieldMeta[] {
  const props = useProperties().data ?? []
  return [
    ...CORE,
    ...props
      .filter((p) => !p.archived)
      .map((p) => ({
        field: `property.${p.key}`,
        label: p.label,
        kind: PROPERTY_KIND[p.type],
        options: p.options?.map((o) => ({ value: o, label: o })),
      })),
  ]
}

function defaultValue(kind: FieldKind, operator: Operator): unknown {
  if (NO_VALUE.has(operator)) return undefined
  if (operator === 'BETWEEN') return kind === 'date' ? ['', ''] : [NaN, NaN]
  if (['IN', 'NOT_IN', 'HAS_ANY', 'HAS_ALL', 'HAS_NONE'].includes(operator))
    return kind === 'segment' ? '' : []
  if (operator === 'IS') return 'GRANTED'
  return kind === 'number' || operator.includes('LAST_DAYS') ? NaN : ''
}

function Chips({
  options,
  value,
  onChange,
  label,
}: {
  options: Array<{ value: string; label: string }>
  value: string[]
  onChange: (v: string[]) => void
  label: string
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o.value)
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== o.value) : [...value, o.value])}
            className={cn(
              'rounded-full border px-2.5 py-1 text-sm transition-colors',
              on
                ? 'border-primary-strong bg-primary-soft text-slate'
                : 'border-border bg-surface text-muted hover:bg-neutral-soft',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function ValueEditor({
  meta,
  rule,
  onChange,
}: {
  meta: FieldMeta
  rule: FilterRule
  onChange: (v: unknown) => void
}) {
  const tags = useTags().data ?? []
  const segments = useSegments().data ?? []
  const op = rule.operator
  if (NO_VALUE.has(op)) return null
  const label = `Value for ${meta.label}`
  if (meta.kind === 'tags')
    return (
      <Chips
        label={label}
        options={tags.map((t) => ({ value: t.id, label: t.name }))}
        value={(rule.value as string[]) ?? []}
        onChange={onChange}
      />
    )
  if (meta.kind === 'enum' || meta.kind === 'select')
    return (
      <Chips
        label={label}
        options={meta.options ?? []}
        value={(rule.value as string[]) ?? []}
        onChange={onChange}
      />
    )
  if (meta.kind === 'consent')
    return (
      <Select value={String(rule.value ?? 'GRANTED')} onValueChange={onChange}>
        <SelectTrigger className="h-9 w-40" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="GRANTED">Opted in</SelectItem>
          <SelectItem value="REVOKED">Opted out</SelectItem>
          <SelectItem value="NONE">No consent</SelectItem>
        </SelectContent>
      </Select>
    )
  if (meta.kind === 'segment')
    return (
      <Select value={String(rule.value ?? '')} onValueChange={onChange}>
        <SelectTrigger className="h-9 w-56" aria-label={label}>
          <SelectValue placeholder="Choose a segment" />
        </SelectTrigger>
        <SelectContent>
          {segments.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  const numeric = meta.kind === 'number' || op.includes('LAST_DAYS')
  const type = numeric ? 'number' : meta.kind === 'date' ? 'date' : 'text'
  const parse = (s: string) => (numeric ? (s === '' ? NaN : Number(s)) : s)
  const show = (v: unknown) => (typeof v === 'number' && Number.isNaN(v) ? '' : String(v ?? ''))
  if (op === 'BETWEEN') {
    const [a, b] = (rule.value as unknown[]) ?? []
    return (
      <span className="flex items-center gap-2">
        <Input
          className="h-9 w-36"
          type={type}
          aria-label={`${label} from`}
          value={show(a)}
          onChange={(e) => onChange([parse(e.target.value), b])}
        />
        <span className="text-sm text-muted">and</span>
        <Input
          className="h-9 w-36"
          type={type}
          aria-label={`${label} to`}
          value={show(b)}
          onChange={(e) => onChange([a, parse(e.target.value)])}
        />
      </span>
    )
  }
  return (
    <Input
      className="h-9 w-48"
      type={type}
      aria-label={label}
      value={show(rule.value)}
      min={op.includes('LAST_DAYS') ? 1 : undefined}
      onChange={(e) => onChange(parse(e.target.value))}
    />
  )
}

function RuleRow({
  rule,
  fields,
  onChange,
  onRemove,
}: {
  rule: FilterRule
  fields: FieldMeta[]
  onChange: (r: FilterRule) => void
  onRemove: () => void
}) {
  const meta = fields.find((f) => f.field === rule.field) ?? fields[0]!
  const operators = OPERATORS_BY_KIND[meta.kind] as readonly Operator[]
  const custom = fields.filter((f) => f.field.startsWith('property.'))
  return (
    <div className="flex flex-wrap items-start gap-2 rounded-md border border-border bg-surface p-2">
      <Select
        value={rule.field}
        onValueChange={(field) => {
          const next = fields.find((f) => f.field === field)!
          const operator = (OPERATORS_BY_KIND[next.kind] as readonly Operator[])[0]!
          onChange({ field, operator, value: defaultValue(next.kind, operator) })
        }}
      >
        <SelectTrigger className="h-9 w-52" aria-label="Field">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Contact</SelectLabel>
            {fields
              .filter((f) => !f.field.startsWith('property.'))
              .map((f) => (
                <SelectItem key={f.field} value={f.field}>
                  {f.label}
                </SelectItem>
              ))}
          </SelectGroup>
          {custom.length ? (
            <SelectGroup>
              <SelectLabel>Custom fields</SelectLabel>
              {custom.map((f) => (
                <SelectItem key={f.field} value={f.field}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectGroup>
          ) : null}
        </SelectContent>
      </Select>
      <Select
        value={rule.operator}
        onValueChange={(operator) =>
          onChange({
            ...rule,
            operator: operator as Operator,
            value: defaultValue(meta.kind, operator as Operator),
          })
        }
      >
        <SelectTrigger className="h-9 w-48" aria-label="Condition">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {operators.map((o) => (
            <SelectItem key={o} value={o}>
              {OPERATOR_LABEL[o]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="min-w-0 flex-1">
        <ValueEditor meta={meta} rule={rule} onChange={(value) => onChange({ ...rule, value })} />
      </div>
      <Button variant="ghost" size="icon" aria-label="Remove condition" onClick={onRemove}>
        <X aria-hidden="true" />
      </Button>
    </div>
  )
}

function Group({
  value,
  onChange,
  fields,
  nested,
  onRemove,
}: {
  value: ContactFilter
  onChange: (f: ContactFilter) => void
  fields: FieldMeta[]
  nested?: boolean
  onRemove?: () => void
}) {
  const setRule = (i: number, r: FilterRule | ContactFilter) =>
    onChange({ ...value, rules: value.rules.map((x, j) => (j === i ? r : x)) })
  const remove = (i: number) => onChange({ ...value, rules: value.rules.filter((_, j) => j !== i) })
  const addRule = () =>
    onChange({
      ...value,
      rules: [...value.rules, { field: 'name', operator: 'CONTAINS', value: '' }],
    })
  return (
    <div
      className={cn(
        'flex flex-col gap-2',
        nested && 'rounded-md border border-dashed border-border p-3',
      )}
    >
      <div className="flex items-center gap-2 text-sm text-slate">
        <span>Match</span>
        <Select
          value={value.op}
          onValueChange={(op) => onChange({ ...value, op: op as 'AND' | 'OR' })}
        >
          <SelectTrigger className="h-8 w-24" aria-label={nested ? 'Group match' : 'Match'}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="AND">all</SelectItem>
            <SelectItem value="OR">any</SelectItem>
          </SelectContent>
        </Select>
        <span>of these conditions</span>
        {onRemove ? (
          <Button variant="ghost" size="sm" className="ml-auto" onClick={onRemove}>
            Remove group
          </Button>
        ) : null}
      </div>
      {value.rules.map((r, i) =>
        isFilterGroup(r) ? (
          <Group
            key={i}
            value={r}
            onChange={(g) => setRule(i, g)}
            fields={fields}
            nested
            onRemove={() => remove(i)}
          />
        ) : (
          <RuleRow
            key={i}
            rule={r}
            fields={fields}
            onChange={(x) => setRule(i, x)}
            onRemove={() => remove(i)}
          />
        ),
      )}
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={addRule}>
          <Plus aria-hidden="true" />
          Add condition
        </Button>
        {!nested ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              onChange({
                ...value,
                rules: [
                  ...value.rules,
                  { op: 'OR', rules: [{ field: 'name', operator: 'CONTAINS', value: '' }] },
                ],
              })
            }
          >
            Add group
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/** Visual editor for the contact filter DSL (lists, segments; campaigns reuse it in Phase 9). */
export function FilterBuilder({
  value,
  onChange,
}: {
  value: ContactFilter
  onChange: (f: ContactFilter) => void
}) {
  const fields = useFields()
  return <Group value={value} onChange={onChange} fields={fields} />
}

'use client'

import {
  type AudienceSource,
  type Campaign,
  type CampaignAudience,
  type CampaignEstimate,
  type ContactFilter,
  EMPTY_FILTER,
  type ImportJob,
  requiredVariables,
  type TemplateComponents,
  type VariableMapping,
  type VariableSource,
  type WhatsAppConnection,
} from '@fenwira/contracts'
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  cn,
  Field,
  Input,
  MetricCard,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  toast,
  useConfirm,
} from '@fenwira/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { type ReactNode, useId, useMemo, useState } from 'react'
import { completeFilter, FilterBuilder } from '@/components/contacts/filter-builder'
import { useSession } from '@/components/session/session-provider'
import { TemplatePreview } from '@/components/templates/template-preview'
import { ApiError, get, patch, post } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import {
  campaignsKey,
  FIELD_LABEL,
  formatInZone,
  money,
  skipLabel,
  utcToZoned,
  zonedToUtc,
} from '@/lib/campaigns'
import { useProperties, useSegments, useTags } from '@/lib/contacts'
import { CATEGORY_LABEL, languageLabel, useApprovedTemplates } from '@/lib/templates'

const STEPS = ['Audience', 'Template', 'Personalize', 'Schedule', 'Review'] as const
type Kind = AudienceSource['kind']
const KIND_LABEL: Partial<Record<Kind, string>> = {
  TAGS: 'Contacts with tags',
  SEGMENT: 'A saved segment',
  FILTER: 'Contacts matching a filter',
  IMPORT: 'Contacts from an import',
}

function Labeled({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <span id={id} className="text-sm font-medium text-slate">
        {label}
      </span>
      {children(id)}
    </div>
  )
}

function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  )
}

/** Source picker for one template variable: a contact field, a custom field, or fixed text. */
function VariablePicker({
  label,
  value,
  onChange,
  properties,
}: {
  label: string
  value: VariableSource | undefined
  onChange: (v: VariableSource) => void
  properties: Array<{ key: string; label: string }>
}) {
  const selected = !value
    ? ''
    : value.kind === 'STATIC'
      ? 'STATIC'
      : value.kind === 'FIELD'
        ? `FIELD:${value.field}`
        : `PROPERTY:${value.key}`
  const fallback = value && value.kind !== 'STATIC' ? (value.fallback ?? '') : ''
  return (
    <div className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2">
      <Labeled label={`${label}: value`}>
        {(id) => (
          <Select
            value={selected}
            onValueChange={(v) => {
              if (v === 'STATIC') onChange({ kind: 'STATIC', value: '' })
              else if (v.startsWith('FIELD:'))
                onChange({ kind: 'FIELD', field: v.slice(6) as keyof typeof FIELD_LABEL, fallback })
              else onChange({ kind: 'PROPERTY', key: v.slice(9), fallback })
            }}
          >
            <SelectTrigger aria-labelledby={id}>
              <SelectValue placeholder="Choose a value" />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(FIELD_LABEL) as Array<keyof typeof FIELD_LABEL>).map((f) => (
                <SelectItem key={f} value={`FIELD:${f}`}>
                  {FIELD_LABEL[f]}
                </SelectItem>
              ))}
              {properties.map((p) => (
                <SelectItem key={p.key} value={`PROPERTY:${p.key}`}>
                  {p.label} (custom field)
                </SelectItem>
              ))}
              <SelectItem value="STATIC">Fixed text</SelectItem>
            </SelectContent>
          </Select>
        )}
      </Labeled>
      {value?.kind === 'STATIC' ? (
        <Field label={`${label}: text`}>
          <Input
            value={value.value}
            onChange={(e) => onChange({ kind: 'STATIC', value: e.target.value })}
          />
        </Field>
      ) : value ? (
        <Field
          label={`${label}: if empty, use`}
          hint="Leave blank to skip contacts without a value."
        >
          <Input
            value={fallback}
            onChange={(e) => onChange({ ...value, fallback: e.target.value || undefined })}
          />
        </Field>
      ) : null}
    </div>
  )
}

/**
 * Create Campaign wizard (docs/CAMPAIGN_ENGINE.md): Audience → Template → Personalize → Schedule →
 * Review → Launch, with a persistent summary on wide screens (UX_PATTERNS → Campaigns). The draft is saved at every step; Review runs the server estimate.
 */
export function CampaignWizard({ campaign }: { campaign?: Campaign }) {
  const { tenantId, can } = useSession()
  const router = useRouter()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [step, setStep] = useState(0)
  const [saved, setSaved] = useState<Campaign | undefined>(campaign)
  const [name, setName] = useState(campaign?.name ?? '')
  const first = campaign?.audience.include[0]
  const [kind, setKind] = useState<Kind>(first?.kind ?? 'TAGS')
  const [tagIds, setTagIds] = useState<string[]>(first?.kind === 'TAGS' ? first.tagIds : [])
  const [match, setMatch] = useState<'ANY' | 'ALL'>(first?.kind === 'TAGS' ? first.match : 'ANY')
  const [segmentId, setSegmentId] = useState(first?.kind === 'SEGMENT' ? first.segmentId : '')
  const [filter, setFilter] = useState<ContactFilter>(
    first?.kind === 'FILTER' ? first.filter : EMPTY_FILTER,
  )
  const [importJobId, setImportJobId] = useState(first?.kind === 'IMPORT' ? first.importJobId : '')
  const exclusion = campaign?.audience.exclude[0]
  const [excludeTags, setExcludeTags] = useState<string[]>(
    exclusion?.kind === 'TAGS' ? exclusion.tagIds : [],
  )
  const [phoneId, setPhoneId] = useState(campaign?.phoneNumberId ?? '')
  const [versionId, setVersionId] = useState(campaign?.templateVersionId ?? '')
  const [mapping, setMapping] = useState<VariableMapping>(campaign?.variableMapping ?? { body: [] })
  const [later, setLater] = useState(Boolean(campaign?.scheduleAt))
  const zone = saved?.timezone ?? 'Asia/Kolkata'
  const initialAt = campaign?.scheduleAt
    ? utcToZoned(campaign.scheduleAt, zone)
    : { date: '', time: '09:00' }
  const [date, setDate] = useState(initialAt.date)
  const [time, setTime] = useState(initialAt.time)
  const [rate, setRate] = useState(
    campaign?.rateLimitPerMinute ? String(campaign.rateLimitPerMinute) : '',
  )

  const tags = useTags().data ?? []
  const segments = useSegments().data ?? []
  const properties = (useProperties().data ?? []).filter((p) => !p.archived)
  const imports = useQuery({
    queryKey: keys.tenant(tenantId, 'imports'),
    queryFn: () => get<{ data: ImportJob[] }>('/imports').then((r) => r.data),
    enabled: kind === 'IMPORT',
  })
  const numbers = useQuery({
    queryKey: keys.tenant(tenantId, 'whatsapp', 'connections'),
    queryFn: () => get<{ data: WhatsAppConnection[] }>('/whatsapp/connections').then((r) => r.data),
  })
  const live = (numbers.data ?? []).filter((n) => ['CONNECTED', 'FLAGGED'].includes(n.status))
  const phone = phoneId || (live.length === 1 ? live[0]!.id : '')
  const templates = useApprovedTemplates(phone || undefined, Boolean(phone))
  const template = templates.data?.find((t) => t.versionId === versionId)
  const need = template ? requiredVariables(template.components) : null

  const audience = useMemo<CampaignAudience>(() => {
    const include: AudienceSource[] = []
    if (kind === 'TAGS' && tagIds.length) include.push({ kind: 'TAGS', tagIds, match })
    if (kind === 'SEGMENT' && segmentId) include.push({ kind: 'SEGMENT', segmentId })
    if (kind === 'FILTER') {
      const f = completeFilter(filter)
      if (f.rules.length) include.push({ kind: 'FILTER', filter: f })
    }
    if (kind === 'IMPORT' && importJobId) include.push({ kind: 'IMPORT', importJobId })
    return {
      include,
      exclude: excludeTags.length ? [{ kind: 'TAGS', tagIds: excludeTags, match: 'ANY' }] : [],
    }
  }, [kind, tagIds, match, segmentId, filter, importJobId, excludeTags])

  const body = () => ({
    name: name.trim(),
    audience,
    ...(phone ? { phoneNumberId: phone } : {}),
    ...(versionId ? { templateVersionId: versionId } : {}),
    variableMapping: mapping,
    scheduleAt: later && date && time ? zonedToUtc(date, time, zone) : null,
    rateLimitPerMinute: rate ? Number(rate) : null,
  })
  const save = useMutation({
    mutationFn: async () =>
      saved
        ? (await patch<{ data: Campaign }>(`/campaigns/${saved.id}`, body())).data
        : (await post<{ data: Campaign }>('/campaigns', body())).data,
    onSuccess: (c) => {
      setSaved(c)
      void queryClient.invalidateQueries({ queryKey: campaignsKey(tenantId) })
      if (!campaign) window.history.replaceState(null, '', `/campaigns/${c.id}`)
      setStep((s) => Math.min(s + 1, STEPS.length - 1))
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'The draft was not saved.'),
  })
  const estimate = useQuery({
    queryKey: campaignsKey(tenantId, 'estimate', saved?.id ?? 'none', String(saved?.updatedAt)),
    queryFn: () =>
      post<{ data: CampaignEstimate }>(`/campaigns/${saved!.id}/estimate`).then((r) => r.data),
    enabled: step === 4 && Boolean(saved),
  })
  const launch = useMutation({
    mutationFn: () =>
      post<{ data: Campaign }>(`/campaigns/${saved!.id}/launch`, undefined, {
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      }),
    onSuccess: (r) => {
      toast.success(r.data.status === 'SCHEDULED' ? 'Campaign scheduled' : 'Campaign launched')
      void queryClient.invalidateQueries({ queryKey: campaignsKey(tenantId) })
      router.push(`/campaigns/${r.data.id}`)
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'The campaign did not launch.'),
  })

  const canContinue = [
    name.trim().length > 0 && audience.include.length > 0,
    Boolean(phone && versionId),
    Boolean(
      need &&
      Array.from({ length: need.body }, (_, i) => mapping.body[i]).every(Boolean) &&
      Array.from({ length: need.header }, (_, i) => mapping.header?.[i]).every(Boolean) &&
      Object.keys(need.buttons).every((k) => mapping.buttons?.[k]?.[0]),
    ) || template?.category === 'AUTHENTICATION',
    !later || Boolean(date && time),
    true,
  ][step]
  const setVar = (part: 'header' | 'body', i: number, v: VariableSource) =>
    setMapping((m) => {
      const arr = [...(m[part] ?? [])]
      arr[i] = v
      return { ...m, [part]: arr }
    })
  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
  const e = estimate.data

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Campaign steps">
        <ol className="flex flex-wrap gap-2">
          {STEPS.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                aria-current={i === step ? 'step' : undefined}
                disabled={i > step}
                onClick={() => setStep(i)}
                className={cn(
                  'rounded-full border px-3 py-1 text-sm',
                  i === step
                    ? 'border-primary bg-primary-soft font-semibold text-slate'
                    : i < step
                      ? 'border-border bg-surface text-slate'
                      : 'border-border bg-surface text-muted',
                )}
              >
                {i + 1}. {s}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 xl:col-span-2">
          {step === 0 ? (
            <Step title="Who receives it">
              <Field label="Campaign name" hint="Only your team sees it.">
                <Input
                  value={name}
                  onChange={(ev) => setName(ev.target.value)}
                  maxLength={120}
                  required
                />
              </Field>
              <RadioGroup
                aria-label="Audience source"
                value={kind}
                onValueChange={(v) => setKind(v as Kind)}
                className="flex flex-col gap-2"
              >
                {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                  <label key={k} className="flex items-center gap-2 text-sm text-slate">
                    <RadioGroupItem value={k} />
                    {KIND_LABEL[k]}
                  </label>
                ))}
              </RadioGroup>
              {kind === 'TAGS' ? (
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 text-sm font-medium text-slate">Tags</legend>
                  {tags.length ? (
                    <div className="flex flex-wrap gap-3">
                      {tags.map((t) => (
                        <label key={t.id} className="flex items-center gap-2 text-sm text-slate">
                          <Checkbox
                            checked={tagIds.includes(t.id)}
                            onCheckedChange={() => setTagIds((l) => toggle(l, t.id))}
                          />
                          {t.name}
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted">
                      No tags yet. Tag contacts in Contacts first.
                    </p>
                  )}
                  <Labeled label="Match">
                    {(id) => (
                      <Select value={match} onValueChange={(v) => setMatch(v as 'ANY' | 'ALL')}>
                        <SelectTrigger aria-labelledby={id} className="w-64">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ANY">Any of these tags</SelectItem>
                          <SelectItem value="ALL">All of these tags</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </Labeled>
                </fieldset>
              ) : null}
              {kind === 'SEGMENT' ? (
                <Labeled label="Segment">
                  {(id) => (
                    <Select value={segmentId} onValueChange={setSegmentId}>
                      <SelectTrigger aria-labelledby={id}>
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
                  )}
                </Labeled>
              ) : null}
              {kind === 'FILTER' ? <FilterBuilder value={filter} onChange={setFilter} /> : null}
              {kind === 'IMPORT' ? (
                <Labeled label="Import">
                  {(id) => (
                    <Select value={importJobId} onValueChange={setImportJobId}>
                      <SelectTrigger aria-labelledby={id}>
                        <SelectValue placeholder="Choose an import" />
                      </SelectTrigger>
                      <SelectContent>
                        {(imports.data ?? [])
                          .filter((j) => j.status === 'COMPLETED')
                          .map((j) => (
                            <SelectItem key={j.id} value={j.id}>
                              {j.filename ?? j.id}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  )}
                </Labeled>
              ) : null}
              {tags.length ? (
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 text-sm font-medium text-slate">
                    Leave out contacts tagged (optional)
                  </legend>
                  <div className="flex flex-wrap gap-3">
                    {tags.map((t) => (
                      <label key={t.id} className="flex items-center gap-2 text-sm text-slate">
                        <Checkbox
                          checked={excludeTags.includes(t.id)}
                          onCheckedChange={() => setExcludeTags((l) => toggle(l, t.id))}
                        />
                        {t.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}
              <p className="text-sm text-muted">
                The audience is frozen when the campaign starts: later changes to tags or segments
                don’t change who receives it.
              </p>
            </Step>
          ) : null}

          {step === 1 ? (
            <Step title="Template">
              <Labeled label="Send from">
                {(id) => (
                  <Select
                    value={phone}
                    onValueChange={(v) => {
                      setPhoneId(v)
                      setVersionId('')
                    }}
                  >
                    <SelectTrigger aria-labelledby={id}>
                      <SelectValue placeholder="Choose a WhatsApp number" />
                    </SelectTrigger>
                    <SelectContent>
                      {live.map((n) => (
                        <SelectItem key={n.id} value={n.id}>
                          {n.label ?? n.verifiedName} · {n.displayPhoneNumber}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Labeled>
              {phone ? (
                <Labeled label="Approved template">
                  {(id) => (
                    <Select
                      value={versionId}
                      onValueChange={(v) => {
                        setVersionId(v)
                        setMapping({ body: [] })
                      }}
                    >
                      <SelectTrigger aria-labelledby={id}>
                        <SelectValue
                          placeholder={templates.isPending ? 'Loading…' : 'Choose a template'}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {(templates.data ?? []).map((t) => (
                          <SelectItem key={t.versionId} value={t.versionId}>
                            {t.name} · {languageLabel(t.language)} · {CATEGORY_LABEL[t.category]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </Labeled>
              ) : null}
              {template?.category === 'MARKETING' ? (
                <Alert tone="info">
                  Marketing templates go only to contacts who agreed to marketing messages.
                </Alert>
              ) : null}
              {template ? (
                <TemplatePreview components={template.components} samples={template.samples} />
              ) : null}
            </Step>
          ) : null}

          {step === 2 ? (
            <Step title="Fill in the variables">
              {!template || !need ? (
                <Skeleton className="h-24" />
              ) : need.body + need.header + Object.keys(need.buttons).length === 0 ? (
                <p className="text-base text-muted">This template has no variables.</p>
              ) : (
                <>
                  {Array.from({ length: need.header }, (_, i) => (
                    <VariablePicker
                      key={`h${i}`}
                      label={`Header {{${i + 1}}}`}
                      value={mapping.header?.[i]}
                      onChange={(v) => setVar('header', i, v)}
                      properties={properties}
                    />
                  ))}
                  {Array.from({ length: need.body }, (_, i) => (
                    <VariablePicker
                      key={`b${i}`}
                      label={`Message {{${i + 1}}}`}
                      value={mapping.body[i]}
                      onChange={(v) => setVar('body', i, v)}
                      properties={properties}
                    />
                  ))}
                  {Object.keys(need.buttons).map((idx) => (
                    <VariablePicker
                      key={`u${idx}`}
                      label={`Website button ${Number(idx) + 1}`}
                      value={mapping.buttons?.[idx]?.[0]}
                      onChange={(v) =>
                        setMapping((m) => ({ ...m, buttons: { ...m.buttons, [idx]: [v] } }))
                      }
                      properties={properties}
                    />
                  ))}
                  <p className="text-sm text-muted">
                    Contacts missing a value (with no fallback) are skipped, never sent a broken
                    message.
                  </p>
                </>
              )}
            </Step>
          ) : null}

          {step === 3 ? (
            <Step title="When to send">
              <RadioGroup
                aria-label="When to send"
                value={later ? 'later' : 'now'}
                onValueChange={(v) => setLater(v === 'later')}
                className="flex flex-col gap-2"
              >
                <label className="flex items-center gap-2 text-sm text-slate">
                  <RadioGroupItem value="now" /> Send now, after review
                </label>
                <label className="flex items-center gap-2 text-sm text-slate">
                  <RadioGroupItem value="later" /> Schedule for later
                </label>
              </RadioGroup>
              {later ? (
                <div className="flex flex-wrap gap-3">
                  <Field label="Date">
                    <Input type="date" value={date} onChange={(ev) => setDate(ev.target.value)} />
                  </Field>
                  <Field label="Time" hint={`Workspace time (${zone})`}>
                    <Input type="time" value={time} onChange={(ev) => setTime(ev.target.value)} />
                  </Field>
                </div>
              ) : null}
              <Field
                label="Messages per minute (optional)"
                hint="Spread the send out. Meta's per-number limit always applies."
              >
                <Input
                  type="number"
                  min={1}
                  value={rate}
                  onChange={(ev) => setRate(ev.target.value)}
                  className="w-40"
                />
              </Field>
            </Step>
          ) : null}

          {step === 4 ? (
            <Step title="Review">
              {estimate.isPending || !e ? (
                <Skeleton className="h-40" />
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <MetricCard label="Audience" value={e.total.toLocaleString('en-IN')} />
                    <MetricCard
                      label="Will receive it"
                      value={e.sendable.toLocaleString('en-IN')}
                    />
                    <MetricCard
                      label="Left out"
                      value={(e.total - e.sendable).toLocaleString('en-IN')}
                    />
                  </div>
                  {Object.keys(e.skipped).length ? (
                    <section aria-label="Why contacts are left out" className="flex flex-col gap-1">
                      <h3 className="text-sm font-semibold text-slate">
                        Why contacts are left out
                      </h3>
                      <ul className="flex flex-col gap-1 text-sm text-slate">
                        {Object.entries(e.skipped).map(([reason, n]) => (
                          <li key={reason}>
                            {skipLabel(reason)}: {n.toLocaleString('en-IN')}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                  {e.billingEnforced &&
                  e.estimatedCostMinor !== null &&
                  e.availableFundsMinor !== null &&
                  e.estimatedCostMinor > e.availableFundsMinor ? (
                    <Alert tone="warning" title="Not enough credits for everyone">
                      The campaign pauses when the wallet runs out and continues after a top-up.
                    </Alert>
                  ) : null}
                  <p className="text-base text-slate">
                    Estimated cost:{' '}
                    <strong>
                      {e.estimatedCostMinor === null
                        ? 'not available'
                        : money(e.estimatedCostMinor, e.currency)}
                    </strong>
                    {e.availableFundsMinor !== null ? (
                      <>
                        {' '}
                        · Available credits:{' '}
                        <strong>{money(e.availableFundsMinor, e.currency)}</strong>
                      </>
                    ) : null}
                  </p>
                  {e.warnings.map((w) => (
                    <Alert key={w.code} tone="warning">
                      {w.message}
                    </Alert>
                  ))}
                  {template && e.samples.length ? (
                    <section aria-label="Sample messages" className="grid gap-4 md:grid-cols-2">
                      {e.samples.slice(0, 2).map((s) => (
                        <div key={s.phoneE164} className="flex flex-col gap-1">
                          <p className="text-sm text-muted">To {s.contactName ?? s.phoneE164}</p>
                          <TemplatePreview
                            components={template.components as TemplateComponents}
                            samples={s.variables as { body: string[]; header?: string[] }}
                          />
                        </div>
                      ))}
                    </section>
                  ) : null}
                  {later && date ? (
                    <p className="text-base text-slate">
                      Sends on {formatInZone(zonedToUtc(date, time, zone), zone)} ({zone}).
                    </p>
                  ) : null}
                </>
              )}
            </Step>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {step > 0 ? (
              <Button variant="secondary" onClick={() => setStep((s) => s - 1)}>
                Back
              </Button>
            ) : null}
            {step < 4 ? (
              <Button
                loading={save.isPending}
                disabled={!canContinue}
                onClick={() => save.mutate()}
              >
                Save and continue
              </Button>
            ) : can('campaigns.launch') ? (
              <Button
                loading={launch.isPending}
                disabled={!e || e.sendable === 0}
                onClick={async () => {
                  if (!e) return
                  const when =
                    later && date ? formatInZone(zonedToUtc(date, time, zone), zone) : 'right away'
                  const ok = await confirm({
                    title: later ? 'Schedule this campaign?' : 'Launch this campaign now?',
                    description: 'Messages can’t be recalled once WhatsApp delivers them.',
                    impact: [
                      `${e.sendable.toLocaleString('en-IN')} contacts receive “${template?.name ?? 'the template'}” ${later ? `on ${when}` : 'right away'}.`,
                      `${(e.total - e.sendable).toLocaleString('en-IN')} contacts are left out (consent, blocked or missing values).`,
                      e.estimatedCostMinor === null
                        ? 'Estimated cost: not available.'
                        : `Estimated cost ${money(e.estimatedCostMinor, e.currency)}${e.availableFundsMinor !== null ? ` of ${money(e.availableFundsMinor, e.currency)} available` : ''}.`,
                    ],
                    confirmLabel: later ? 'Schedule campaign' : 'Launch campaign',
                  })
                  if (ok) launch.mutate()
                }}
              >
                {later ? 'Schedule campaign' : 'Launch campaign'}
              </Button>
            ) : (
              <p className="text-sm text-muted">
                Someone with permission to launch campaigns can send it.
              </p>
            )}
          </div>
        </div>
        <aside aria-labelledby="campaign-summary" className="hidden xl:block">
          <div className="sticky top-20 flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
            <h2 id="campaign-summary" className="text-md font-semibold text-slate">
              Summary
            </h2>
            <dl className="flex flex-col gap-3 text-sm">
              {[
                ['Name', name.trim() || '—'],
                [
                  'Audience',
                  kind === 'TAGS'
                    ? tagIds.length
                      ? `Tagged ${tags
                          .filter((t) => tagIds.includes(t.id))
                          .map((t) => t.name)
                          .join(match === 'ALL' ? ' and ' : ' or ')}`
                      : '—'
                    : kind === 'SEGMENT'
                      ? (segments.find((x) => x.id === segmentId)?.name ?? '—')
                      : kind === 'FILTER'
                        ? `${completeFilter(filter).rules.length} filter rule(s)`
                        : importJobId
                          ? 'Contacts from an import'
                          : '—',
                ],
                [
                  'Excluding',
                  excludeTags.length
                    ? tags
                        .filter((t) => excludeTags.includes(t.id))
                        .map((t) => t.name)
                        .join(', ')
                    : 'Nobody',
                ],
                ['From', live.find((n) => n.id === phone)?.displayPhoneNumber ?? '—'],
                ['Template', template ? `${template.name} (${template.language})` : '—'],
                [
                  'When',
                  later
                    ? date
                      ? formatInZone(zonedToUtc(date, time, zone), zone)
                      : 'Scheduled (pick a date)'
                    : 'Right after launch',
                ],
                ...(e
                  ? [
                      [
                        'Will receive',
                        `${e.sendable.toLocaleString('en-IN')} of ${e.total.toLocaleString('en-IN')}`,
                      ],
                      [
                        'Estimated cost',
                        e.estimatedCostMinor === null
                          ? 'Not available'
                          : money(e.estimatedCostMinor, e.currency),
                      ],
                    ]
                  : []),
              ].map(([k, v]) => (
                <div key={k} className="flex flex-col gap-0.5">
                  <dt className="text-secondary">{k}</dt>
                  <dd className="text-slate">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </aside>
      </div>
    </div>
  )
}

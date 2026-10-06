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
  type VariableSamples,
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
  EmptyState,
  ErrorState,
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
import { Check } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type ReactNode, useId, useMemo, useRef, useState } from 'react'
import { completeFilter, FilterBuilder } from '@/components/contacts/filter-builder'
import { useSession } from '@/components/session/session-provider'
import { TemplatePreview } from '@/components/templates/template-preview'
import { ApiError, get, patch, post } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import {
  campaignsKey,
  campaignConfigSignature,
  FIELD_LABEL,
  formatInZone,
  money,
  skipLabel,
  utcToZoned,
  zonedToUtc,
} from '@/lib/campaigns'
import { useProperties, useSegments, useTags } from '@/lib/contacts'
import { useDraftProtection } from './use-draft-protection'
import {
  CATEGORY_LABEL,
  languageLabel,
  useApprovedTemplates,
  useTemplateSampleUrl,
} from '@/lib/templates'

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
export function CampaignWizard({
  campaign,
  initialTemplateVersionId,
}: {
  campaign?: Campaign
  initialTemplateVersionId?: string
}) {
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
  const [versionId, setVersionId] = useState(
    campaign?.templateVersionId ?? initialTemplateVersionId ?? '',
  )
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
    ...(template ? { templateVersionId: template.versionId } : {}),
    variableMapping: mapping,
    scheduleAt: later && date && time ? zonedToUtc(date, time, zone) : null,
    rateLimitPerMinute: rate ? Number(rate) : null,
  })
  // Compare form configuration, excluding the virtual automatically selected number.
  const signature = campaignConfigSignature({
    ...body(),
    phoneNumberId: phoneId,
    templateVersionId: versionId,
  })
  const [savedSignature, setSavedSignature] = useState(signature)
  const meaningful = Boolean(name.trim() || audience.include.length || versionId || rate || later)
  const dirty = signature !== savedSignature && (Boolean(saved) || meaningful)
  const operationLock = useRef(false)
  const launchKey = useRef<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [sampleIndex, setSampleIndex] = useState('0')
  const save = useMutation({
    mutationFn: async ({
      payload,
    }: {
      payload: ReturnType<typeof body>
      signature: string
      advance: boolean
    }) =>
      saved
        ? (await patch<{ data: Campaign }>(`/campaigns/${saved.id}`, payload)).data
        : (await post<{ data: Campaign }>('/campaigns', payload)).data,
    onSuccess: (c, submitted) => {
      setSaved(c)
      setSavedSignature(submitted.signature)
      launchKey.current = null
      void queryClient.invalidateQueries({ queryKey: campaignsKey(tenantId) })
      if (!campaign) window.history.replaceState(null, '', `/campaigns/${c.id}`)
      if (submitted.advance) setStep((s) => Math.min(s + 1, STEPS.length - 1))
      else toast.success('Draft saved')
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'The draft was not saved.'),
    onSettled: () => {
      operationLock.current = false
    },
  })
  const previewMatchesSaved = Boolean(
    saved &&
    template &&
    campaignConfigSignature([audience, phone, versionId, mapping]) ===
      campaignConfigSignature([
        saved.audience,
        saved.phoneNumberId,
        saved.templateVersionId,
        saved.variableMapping,
      ]),
  )
  const estimate = useQuery({
    queryKey: campaignsKey(tenantId, 'estimate', saved?.id ?? 'none', String(saved?.updatedAt)),
    queryFn: () =>
      post<{ data: CampaignEstimate }>(`/campaigns/${saved!.id}/estimate`).then((r) => r.data),
    enabled: Boolean(saved && saved.templateVersionId && saved.phoneNumberId) && step >= 2,
  })
  const launch = useMutation({
    mutationFn: () => {
      launchKey.current ??= crypto.randomUUID()
      return post<{ data: Campaign }>(`/campaigns/${saved!.id}/launch`, undefined, {
        headers: { 'Idempotency-Key': launchKey.current },
      })
    },
    onSuccess: (r) => {
      toast.success(r.data.status === 'SCHEDULED' ? 'Campaign scheduled' : 'Campaign launched')
      void queryClient.invalidateQueries({ queryKey: campaignsKey(tenantId) })
      router.push(`/campaigns/${r.data.id}`)
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'The campaign did not launch.'),
    onSettled: () => {
      operationLock.current = false
    },
  })
  const busy = save.isPending || launch.isPending || confirming
  useDraftProtection(dirty, busy, saved?.id)
  const beginSave = (advance: boolean) => {
    if (operationLock.current) return
    operationLock.current = true
    save.mutate({ payload: body(), signature, advance })
  }
  const header = template?.components.header
  const sampleUrl = useTemplateSampleUrl(
    header && header.format !== 'TEXT' ? header.sampleFileId : null,
  )
  const canContinue = [
    name.trim().length > 0 && audience.include.length > 0,
    Boolean(phone && template),
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Campaign steps">
          <ol className="flex flex-wrap gap-1">
            {STEPS.map((label, i) => (
              <li key={label}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-current={i === step ? 'step' : undefined}
                  disabled={i > step || busy}
                  onClick={() => setStep(i)}
                  className={cn(i === step && 'bg-primary-soft text-primary-strong')}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex size-6 items-center justify-center rounded-full border text-sm',
                      i <= step
                        ? 'border-primary-strong text-primary-strong'
                        : 'border-border text-muted',
                    )}
                  >
                    {i < step ? <Check aria-hidden="true" className="size-3" /> : i + 1}
                  </span>
                  {label}
                </Button>
              </li>
            ))}
          </ol>
        </nav>
        <p role="status" className="text-sm text-muted">
          {save.isPending
            ? 'Saving draft…'
            : dirty
              ? 'Unsaved changes'
              : saved
                ? 'Draft saved'
                : 'Not saved yet'}
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-5">
        <fieldset disabled={busy} className="flex min-w-0 flex-col gap-5 lg:col-span-3">
          <legend className="sr-only">Campaign configuration</legend>
          {save.isError ? (
            <Alert tone="danger" title="Draft couldn’t be saved">
              {save.error instanceof ApiError
                ? save.error.message
                : 'Your changes are still here. Try saving again.'}
            </Alert>
          ) : null}
          {launch.isError ? (
            <Alert tone="danger" title="Launch couldn’t be confirmed">
              {launch.error instanceof ApiError
                ? launch.error.message
                : 'Try again to confirm the launch.'}{' '}
              Retry uses the same launch reference.
            </Alert>
          ) : null}
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
                      setMapping({ body: [] })
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
              {numbers.isError ? (
                <ErrorState
                  title="WhatsApp numbers couldn’t be loaded"
                  onRetry={() => void numbers.refetch()}
                />
              ) : null}
              {phone && templates.isError ? (
                <ErrorState
                  title="Approved templates couldn’t be loaded"
                  onRetry={() => void templates.refetch()}
                />
              ) : null}
              {phone && !templates.isPending && !templates.isError && !templates.data?.length ? (
                <EmptyState
                  title="No approved messages for this number"
                  description="Create or sync a template, then wait for Meta’s approval."
                  action={
                    can('templates.read') ? (
                      <Button variant="secondary" asChild>
                        <Link href="/templates">Open templates</Link>
                      </Button>
                    ) : undefined
                  }
                />
              ) : null}
              {versionId && phone && !templates.isPending && !templates.isError && !template ? (
                <Alert tone="warning" title="Selected template unavailable">
                  Choose an approved version for this WhatsApp number. The saved draft remains
                  available.
                </Alert>
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
              {estimate.isError ? (
                <ErrorState
                  title="Recipient estimate couldn’t be loaded"
                  onRetry={() => void estimate.refetch()}
                />
              ) : estimate.isPending || !e ? (
                <Skeleton className="h-40" />
              ) : (
                <>
                  <dl className="grid grid-cols-3 gap-3 rounded-md border border-border bg-neutral-soft p-4">
                    {[
                      ['Audience', e.total],
                      ['Will receive it', e.sendable],
                      ['Left out', e.total - e.sendable],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-sm text-muted">{label}</dt>
                        <dd className="text-lg font-semibold">
                          {Number(value).toLocaleString('en-IN')}
                        </dd>
                      </div>
                    ))}
                  </dl>
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
                    Estimated customer charge:{' '}
                    <strong>
                      {e.estimatedCostMinor === null
                        ? 'not available'
                        : money(e.estimatedCostMinor, e.currency)}
                    </strong>
                    {e.availableFundsMinor !== null ? (
                      <>
                        {' '}
                        · Wallet available:{' '}
                        <strong>{money(e.availableFundsMinor, e.currency)}</strong>
                      </>
                    ) : null}
                  </p>
                  {e.warnings.map((w) => (
                    <Alert key={w.code} tone="warning">
                      {w.message}
                    </Alert>
                  ))}
                  {later && date && time ? (
                    <p className="text-base text-slate">
                      Sends on {formatInZone(zonedToUtc(date, time, zone), zone)} ({zone}).
                    </p>
                  ) : null}
                </>
              )}
            </Step>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <Button
              variant="secondary"
              loading={save.isPending && !save.variables?.advance}
              disabled={!name.trim() || busy}
              onClick={() => beginSave(false)}
            >
              Save draft
            </Button>
            {step > 0 ? (
              <Button variant="secondary" onClick={() => setStep((s) => s - 1)}>
                Back
              </Button>
            ) : null}
            {step < 4 ? (
              <Button
                loading={save.isPending && save.variables?.advance}
                disabled={!canContinue || busy}
                onClick={() => beginSave(true)}
              >
                Save and continue
              </Button>
            ) : can('campaigns.launch') ? (
              <Button
                loading={launch.isPending}
                disabled={
                  !e || estimate.isError || estimate.isFetching || e.sendable === 0 || dirty || busy
                }
                onClick={async () => {
                  if (!e || operationLock.current) return
                  operationLock.current = true
                  setConfirming(true)
                  const when =
                    later && date ? formatInZone(zonedToUtc(date, time, zone), zone) : 'right away'
                  const ok = await confirm({
                    title: later ? 'Schedule this campaign?' : 'Launch this campaign now?',
                    description: 'Messages can’t be recalled once WhatsApp delivers them.',
                    impact: [
                      `${e.sendable.toLocaleString('en-IN')} contacts receive “${template?.name ?? 'the template'}” ${later ? `on ${when}` : 'right away'}.`,
                      `${(e.total - e.sendable).toLocaleString('en-IN')} contacts are left out (consent, blocked or missing values).`,
                      e.estimatedCostMinor === null
                        ? 'Estimated customer charge: not available.'
                        : `Estimated customer charge ${money(e.estimatedCostMinor, e.currency)}${e.availableFundsMinor !== null ? ` of ${money(e.availableFundsMinor, e.currency)} available` : ''}.`,
                    ],
                    confirmLabel: later ? 'Schedule campaign' : 'Launch campaign',
                  })
                  setConfirming(false)
                  if (ok) launch.mutate()
                  else operationLock.current = false
                }}
              >
                {later ? 'Schedule campaign' : 'Launch campaign'}
              </Button>
            ) : (
              <p className="text-sm text-muted">
                Someone with permission to launch campaigns can send it.
              </p>
            )}
            <Button variant="ghost" asChild>
              <Link href="/campaigns">Exit</Link>
            </Button>
          </div>
        </fieldset>
        <aside aria-labelledby="campaign-summary" className="min-w-0 lg:col-span-2">
          <div className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-5 lg:sticky lg:top-20">
            <div className="flex flex-col gap-3">
              <h2 className="text-md font-semibold text-slate">WhatsApp preview</h2>
              {template ? (
                <>
                  <p className="text-sm text-secondary">
                    {template.name} · {languageLabel(template.language)}
                  </p>
                  {previewMatchesSaved && e?.samples.length ? (
                    <>
                      {e.samples.length > 1 ? (
                        <Labeled label="Preview recipient">
                          {(id) => (
                            <Select value={sampleIndex} onValueChange={setSampleIndex}>
                              <SelectTrigger aria-labelledby={id}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {e.samples.map((sample, i) => (
                                  <SelectItem key={sample.phoneE164} value={String(i)}>
                                    {sample.contactName ?? sample.phoneE164}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </Labeled>
                      ) : (
                        <p className="text-sm text-muted">
                          To {e.samples[0]?.contactName ?? e.samples[0]?.phoneE164}
                        </p>
                      )}
                      <TemplatePreview
                        components={template.components}
                        samples={
                          (e.samples[Number(sampleIndex)] ?? e.samples[0])!
                            .variables as VariableSamples
                        }
                        headerImageUrl={sampleUrl.data}
                      />
                      <p className="text-sm text-muted">
                        Recipient values from the saved server estimate. Eligibility is checked
                        again when sending.
                      </p>
                    </>
                  ) : (
                    <>
                      <TemplatePreview
                        components={template.components}
                        samples={template.samples}
                        headerImageUrl={sampleUrl.data}
                      />
                      <p className="text-sm text-muted">
                        Template example values. Save your audience and personalization to preview
                        recipient values.
                      </p>
                    </>
                  )}
                </>
              ) : (
                <EmptyState
                  title="Choose a message to preview"
                  description="An approved WhatsApp template appears here as you prepare the campaign."
                />
              )}
            </div>
            <h2
              id="campaign-summary"
              className="border-t border-border pt-4 text-md font-semibold text-slate"
            >
              Campaign summary
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
                    ? date && time
                      ? formatInZone(zonedToUtc(date, time, zone), zone)
                      : 'Scheduled (pick a date)'
                    : 'Right after launch',
                ],
                ...(e && previewMatchesSaved
                  ? [
                      [
                        'Will receive',
                        `${e.sendable.toLocaleString('en-IN')} of ${e.total.toLocaleString('en-IN')}`,
                      ],
                      [
                        'Estimated customer charge',
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

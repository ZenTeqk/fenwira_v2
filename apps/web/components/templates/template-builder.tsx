'use client'

import {
  type Template,
  TEMPLATE_CATEGORIES,
  TEMPLATE_HEADER_MEDIA,
  TEMPLATE_LIMITS,
  type TemplateButton,
  type TemplateCategory,
  type TemplateDraft,
  type TemplateIssue,
  requiredVariables,
  validateTemplate,
  variableCount,
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
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownTrigger,
  Field,
  Input,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@fenwira/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { type ReactNode, useId, useMemo, useRef, useState } from 'react'
import { useSession } from '@/components/session/session-provider'
import { ApiError, patch, post } from '@/lib/api/client'
import {
  CATEGORY_HINT,
  CATEGORY_LABEL,
  emptyDraft,
  TEMPLATE_LANGUAGES,
  templatesKey,
  useTemplateAccounts,
  useTemplateSampleUrl,
} from '@/lib/templates'
import { TemplatePreview } from './template-preview'

type HeaderKind = 'NONE' | 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT'
const HEADER_LABEL: Record<HeaderKind, string> = {
  NONE: 'None',
  TEXT: 'Text',
  IMAGE: 'Image',
  VIDEO: 'Video',
  DOCUMENT: 'Document',
}
const NEW_BUTTON: Record<TemplateButton['type'], [string, TemplateButton]> = {
  QUICK_REPLY: ['Quick reply', { type: 'QUICK_REPLY', text: '' }],
  URL: ['Visit website', { type: 'URL', text: '', url: 'https://' }],
  PHONE_NUMBER: ['Call phone number', { type: 'PHONE_NUMBER', text: '', phoneE164: '+' }],
  COPY_CODE: ['Copy offer code', { type: 'COPY_CODE', example: '' }],
}
const toName = (v: string) =>
  v
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
const textareaClass =
  'min-h-28 w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-slate'

/** Errors and warnings for a field path (and its children). */
const issuesAt = (issues: TemplateIssue[], path: string) =>
  issues.filter((i) => i.path === path || i.path.startsWith(`${path}.`))
const message = (issues: TemplateIssue[], path: string) => issuesAt(issues, path)[0]?.message

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  )
}

/** Inserts the next `{{n}}` at the cursor of a text field. */
function useVariableInserter(
  ref: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
  value: string,
  onChange: (v: string) => void,
) {
  return () => {
    const el = ref.current
    const token = `{{${variableCount(value) + 1}}}`
    const at = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? at
    onChange(`${value.slice(0, at)}${token}${value.slice(end)}`)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(at + token.length, at + token.length)
    })
  }
}

/**
 * The two-pane template builder (docs/TEMPLATE_ENGINE.md → Builder UX). Validation runs the same
 * `validateTemplate` as the API on every change; Meta-side checks come back from save/submit.
 */
export function TemplateBuilder({
  template,
  initial,
  onSaved,
}: {
  /** Editing this template's current DRAFT; omitted when creating. */
  template?: Template
  initial: TemplateDraft
  onSaved: (t: Template) => void
}) {
  const { tenantId, can } = useSession()
  const queryClient = useQueryClient()
  const accounts = useTemplateAccounts()
  const [draft, setDraft] = useState<TemplateDraft>(initial)
  const [wabaId, setWabaId] = useState<string>(template?.wabaId ?? '')
  const [serverIssues, setServerIssues] = useState<TemplateIssue[]>([])
  const account = wabaId || (accounts.data?.length === 1 ? accounts.data[0]!.id : '')
  const submitted = Boolean(
    template && (template.currentVersion.metaTemplateId || template.currentVersion.version > 1),
  )
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const headerRef = useRef<HTMLInputElement>(null)
  const ids = { category: useId(), language: useId(), header: useId(), account: useId() }

  const local = useMemo(() => validateTemplate(draft), [draft])
  const errors = [
    ...local.errors,
    ...serverIssues.filter(
      (s) => !local.errors.some((l) => l.code === s.code && l.path === s.path),
    ),
  ]
  const c = draft.components
  const need = requiredVariables(c)
  const headerKind: HeaderKind = c.header?.format ?? 'NONE'

  const set = (next: Partial<TemplateDraft>) => {
    setServerIssues([])
    setDraft((d) => ({ ...d, ...next }))
  }
  const setComponents = (next: Partial<TemplateDraft['components']>) =>
    set({ components: { ...c, ...next } })
  const setSample = (part: 'header' | 'body', i: number, v: string) => {
    const arr = [...(draft.samples[part] ?? [])]
    arr[i] = v
    set({ samples: { ...draft.samples, [part]: arr } })
  }
  const setButtonSample = (index: number, v: string) =>
    set({
      samples: { ...draft.samples, buttons: { ...draft.samples.buttons, [String(index)]: [v] } },
    })
  const insertBody = useVariableInserter(bodyRef, c.body.text, (text) =>
    setComponents({ body: { text } }),
  )
  const insertHeader = useVariableInserter(
    headerRef,
    c.header?.format === 'TEXT' ? c.header.text : '',
    (text) => setComponents({ header: { format: 'TEXT', text } }),
  )
  const setButton = (i: number, b: TemplateButton) =>
    setComponents({ buttons: (c.buttons ?? []).map((x, j) => (j === i ? b : x)) })
  const removeButton = (i: number) => {
    const buttons = (c.buttons ?? []).filter((_, j) => j !== i)
    const samples = Object.fromEntries(
      Object.entries(draft.samples.buttons ?? {})
        .filter(([k]) => Number(k) !== i)
        .map(([k, v]) => [String(Number(k) > i ? Number(k) - 1 : Number(k)), v]),
    )
    set({
      components: { ...c, buttons: buttons.length ? buttons : undefined },
      samples: { ...draft.samples, buttons: samples },
    })
  }
  const changeCategory = (category: TemplateCategory) => {
    if ((category === 'AUTHENTICATION') !== (draft.category === 'AUTHENTICATION'))
      setDraft({ ...emptyDraft(category), name: draft.name, language: draft.language })
    else set({ category })
  }

  // Header sample upload (presigned PUT, then the server checks the bytes).
  const sampleId = c.header && c.header.format !== 'TEXT' ? c.header.sampleFileId : null
  const sampleUrl = useTemplateSampleUrl(sampleId)
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const up = await post<{
        data: { fileId: string; url: string; headers: Record<string, string> }
      }>('/templates/samples/upload-url', {
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        filename: file.name,
      })
      const put = await fetch(up.data.url, { method: 'PUT', headers: up.data.headers, body: file })
      if (!put.ok) throw new Error('The upload failed.')
      const done = await post<{ data: { status: string } }>(
        `/templates/samples/${up.data.fileId}/complete`,
      )
      if (done.data.status !== 'READY') throw new Error("This file doesn't match its type.")
      return up.data.fileId
    },
    onSuccess: (fileId) => {
      if (c.header && c.header.format !== 'TEXT')
        setComponents({ header: { format: c.header.format, sampleFileId: fileId } })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'The upload failed.'),
  })

  const handleError = (err: unknown) => {
    if (err instanceof ApiError && err.code === 'TEMPLATE_INVALID') {
      setServerIssues((err.details?.errors as TemplateIssue[] | undefined) ?? [])
      toast.error('Fix the highlighted problems.')
    } else if (err instanceof ApiError && err.code === 'TEMPLATE_NAME_TAKEN') {
      setServerIssues([{ code: 'TEMPLATE_NAME_TAKEN', path: 'name', message: err.message }])
    } else toast.error(err instanceof ApiError ? err.message : 'Something went wrong.')
  }
  const save = useMutation({
    mutationFn: async (then: 'save' | 'submit') => {
      const saved = template
        ? await patch<{ data: Template }>(
            `/templates/${template.id}`,
            submitted ? { components: draft.components, samples: draft.samples } : draft,
          )
        : await post<{ data: Template }>('/templates', { ...draft, wabaId: account })
      if (then === 'save') return saved.data
      try {
        const res = await post<{ data: Template }>(
          `/templates/${saved.data.id}/submit`,
          undefined,
          {
            headers: { 'Idempotency-Key': crypto.randomUUID() },
          },
        )
        return res.data
      } catch (error) {
        // Creation already succeeded. Keep the saved identity on failure so retry edits the
        // existing draft instead of attempting another create with the same name/language.
        void queryClient.invalidateQueries({ queryKey: templatesKey(tenantId) })
        onSaved(saved.data)
        throw error
      }
    },
    onSuccess: (t, then) => {
      void queryClient.invalidateQueries({ queryKey: templatesKey(tenantId) })
      toast.success(
        then === 'save'
          ? 'Draft saved'
          : t.status === 'REJECTED'
            ? 'Meta rejected the template'
            : 'Submitted to Meta for review',
      )
      onSaved(t)
    },
    onError: handleError,
  })

  const fieldError = (path: string) => message(errors, path)
  const warnings = local.warnings

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <form
        className="flex flex-col gap-4 lg:col-span-3"
        aria-label="Template editor"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate('save')
        }}
      >
        <Section title="Basics">
          {!template ? (
            <div className="flex flex-col gap-1.5">
              <span id={ids.account} className="text-sm font-medium text-slate">
                WhatsApp Business Account
              </span>
              <Select value={account} onValueChange={setWabaId}>
                <SelectTrigger aria-labelledby={ids.account}>
                  <SelectValue placeholder="Choose an account" />
                </SelectTrigger>
                <SelectContent>
                  {(accounts.data ?? []).map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {accounts.data && !accounts.data.length ? (
                <p className="text-sm text-muted">
                  Connect a WhatsApp number first (Settings → WhatsApp).
                </p>
              ) : null}
            </div>
          ) : null}
          <Field
            label="Name"
            hint="Lowercase letters, numbers and underscores. Customers don't see it."
            error={fieldError('name')}
          >
            <Input
              value={draft.name}
              onChange={(e) => set({ name: toName(e.target.value) })}
              maxLength={TEMPLATE_LIMITS.name}
              disabled={submitted}
              required
            />
          </Field>
          <div className="flex flex-col gap-1.5">
            <span id={ids.language} className="text-sm font-medium text-slate">
              Language
            </span>
            <Select
              value={draft.language}
              onValueChange={(language) => set({ language })}
              disabled={submitted}
            >
              <SelectTrigger aria-labelledby={ids.language}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEMPLATE_LANGUAGES.map((l) => (
                  <SelectItem key={l.code} value={l.code}>
                    {l.label} ({l.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <fieldset className="flex flex-col gap-2" disabled={submitted}>
            <legend id={ids.category} className="mb-1 text-sm font-medium text-slate">
              Category
            </legend>
            <RadioGroup
              aria-labelledby={ids.category}
              value={draft.category}
              onValueChange={(v) => changeCategory(v as TemplateCategory)}
              className="flex flex-col gap-2"
            >
              {TEMPLATE_CATEGORIES.map((cat) => (
                <label key={cat} className="flex items-start gap-2 text-sm text-slate">
                  <RadioGroupItem value={cat} className="mt-0.5" />
                  <span>
                    <span className="font-medium">{CATEGORY_LABEL[cat]}</span>
                    <span className="block text-muted">{CATEGORY_HINT[cat]}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </fieldset>
        </Section>

        {draft.category === 'AUTHENTICATION' ? (
          <Section title="Code message">
            <p className="text-sm text-muted">
              Meta writes the message: “<strong>123456</strong> is your verification code.” You
              choose the extras.
            </p>
            <label className="flex items-center gap-2 text-sm text-slate">
              <Checkbox
                checked={c.auth?.securityRecommendation ?? false}
                onCheckedChange={(v) =>
                  setComponents({
                    auth: {
                      securityRecommendation: v === true,
                      codeExpirationMinutes: c.auth?.codeExpirationMinutes ?? null,
                    },
                  })
                }
              />
              Add “For your security, do not share this code.”
            </label>
            <Field label="Code expires after (minutes)" hint="Optional, 1–90. Shown as the footer.">
              <Input
                type="number"
                min={1}
                max={90}
                value={c.auth?.codeExpirationMinutes ?? ''}
                onChange={(e) =>
                  setComponents({
                    auth: {
                      securityRecommendation: c.auth?.securityRecommendation ?? false,
                      codeExpirationMinutes: e.target.value ? Number(e.target.value) : null,
                    },
                  })
                }
              />
            </Field>
            <Field label="Example code" error={fieldError('samples.body')}>
              <Input
                value={draft.samples.body[0] ?? ''}
                onChange={(e) => setSample('body', 0, e.target.value)}
                maxLength={15}
              />
            </Field>
          </Section>
        ) : (
          <>
            <Section title="Header (optional)">
              <div className="flex flex-col gap-1.5">
                <span id={ids.header} className="text-sm font-medium text-slate">
                  Header type
                </span>
                <Select
                  value={headerKind}
                  onValueChange={(v) => {
                    const kind = v as HeaderKind
                    setComponents({
                      header:
                        kind === 'NONE'
                          ? undefined
                          : kind === 'TEXT'
                            ? { format: 'TEXT', text: '' }
                            : { format: kind, sampleFileId: null },
                    })
                  }}
                >
                  <SelectTrigger aria-labelledby={ids.header}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(HEADER_LABEL) as HeaderKind[]).map((k) => (
                      <SelectItem key={k} value={k}>
                        {HEADER_LABEL[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {c.header?.format === 'TEXT' ? (
                <Field
                  label="Header text"
                  hint={`${c.header.text.length}/${TEMPLATE_LIMITS.headerText}. One variable at most.`}
                  error={fieldError('components.header')}
                >
                  <Input
                    ref={headerRef}
                    value={c.header.text}
                    onChange={(e) =>
                      setComponents({ header: { format: 'TEXT', text: e.target.value } })
                    }
                  />
                </Field>
              ) : null}
              {c.header?.format === 'TEXT' && variableCount(c.header.text) === 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  onClick={insertHeader}
                >
                  <Plus aria-hidden="true" /> Variable in header
                </Button>
              ) : null}
              {c.header && c.header.format !== 'TEXT' ? (
                <Field
                  label={`Sample ${c.header.format.toLowerCase()}`}
                  hint={`${TEMPLATE_HEADER_MEDIA[c.header.format].label}. Meta reviews this sample; you can send a different file each time.`}
                  error={fieldError('components.header.sampleFileId')}
                >
                  <input
                    type="file"
                    accept={
                      c.header.format === 'IMAGE'
                        ? 'image/jpeg,image/png'
                        : c.header.format === 'VIDEO'
                          ? 'video/mp4'
                          : 'application/pdf'
                    }
                    className="text-sm text-slate file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-slate"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) upload.mutate(f)
                    }}
                  />
                </Field>
              ) : null}
              {upload.isPending ? <p className="text-sm text-muted">Uploading…</p> : null}
            </Section>

            <Section title="Message">
              <Field
                label="Message text"
                hint={`${c.body.text.length}/${TEMPLATE_LIMITS.body}. Use *bold*, _italic_ and variables for details that change.`}
                error={fieldError('components.body.text')}
              >
                <textarea
                  ref={bodyRef}
                  className={textareaClass}
                  value={c.body.text}
                  onChange={(e) => setComponents({ body: { text: e.target.value } })}
                  required
                />
              </Field>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="self-start"
                onClick={insertBody}
              >
                <Plus aria-hidden="true" /> Variable
              </Button>
              <Field
                label="Footer (optional)"
                hint={`${c.footer?.text.length ?? 0}/${TEMPLATE_LIMITS.footer}`}
                error={fieldError('components.footer.text')}
              >
                <Input
                  value={c.footer?.text ?? ''}
                  onChange={(e) =>
                    setComponents({ footer: e.target.value ? { text: e.target.value } : undefined })
                  }
                />
              </Field>
            </Section>

            <Section title="Buttons (optional)">
              {(c.buttons ?? []).map((b, i) => (
                <div key={i} className="flex flex-col gap-2 rounded-md border border-border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate">{NEW_BUTTON[b.type][0]}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove button ${i + 1}`}
                      onClick={() => removeButton(i)}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                  {b.type !== 'COPY_CODE' ? (
                    <Field label="Button text" error={fieldError(`components.buttons.${i}.text`)}>
                      <Input
                        value={b.text}
                        maxLength={TEMPLATE_LIMITS.buttonText}
                        onChange={(e) => setButton(i, { ...b, text: e.target.value })}
                      />
                    </Field>
                  ) : (
                    <Field
                      label="Example code"
                      error={fieldError(`components.buttons.${i}.example`)}
                    >
                      <Input
                        value={b.example}
                        maxLength={15}
                        onChange={(e) => setButton(i, { ...b, example: e.target.value })}
                      />
                    </Field>
                  )}
                  {b.type === 'URL' ? (
                    <Field
                      label="Website address"
                      hint="End it with {{1}} to add a value per message."
                      error={fieldError(`components.buttons.${i}.url`)}
                    >
                      <Input
                        value={b.url}
                        onChange={(e) => setButton(i, { ...b, url: e.target.value })}
                      />
                    </Field>
                  ) : null}
                  {b.type === 'PHONE_NUMBER' ? (
                    <Field
                      label="Phone number"
                      hint="International format, for example +919876543210."
                      error={fieldError(`components.buttons.${i}.phoneE164`)}
                    >
                      <Input
                        value={b.phoneE164}
                        onChange={(e) => setButton(i, { ...b, phoneE164: e.target.value })}
                      />
                    </Field>
                  ) : null}
                </div>
              ))}
              {message(errors, 'components.buttons') &&
              !issuesAt(errors, 'components.buttons').some((x) => /\.\d+\./.test(x.path)) ? (
                <p className="text-sm text-danger-strong">
                  {message(errors, 'components.buttons')}
                </p>
              ) : null}
              <Dropdown>
                <DropdownTrigger asChild>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="self-start"
                    disabled={(c.buttons?.length ?? 0) >= TEMPLATE_LIMITS.buttons}
                  >
                    <Plus aria-hidden="true" /> Add button
                  </Button>
                </DropdownTrigger>
                <DropdownContent>
                  {(Object.keys(NEW_BUTTON) as TemplateButton['type'][]).map((t) => (
                    <DropdownItem
                      key={t}
                      onSelect={() =>
                        setComponents({ buttons: [...(c.buttons ?? []), NEW_BUTTON[t][1]] })
                      }
                    >
                      {NEW_BUTTON[t][0]}
                    </DropdownItem>
                  ))}
                </DropdownContent>
              </Dropdown>
            </Section>

            {need.header || need.body || Object.keys(need.buttons).length ? (
              <Section title="Sample values">
                <p className="text-sm text-muted">
                  Meta reviews the template with these examples. Use realistic values.
                </p>
                {Array.from({ length: need.header }, (_, i) => (
                  <Field
                    key={`h${i}`}
                    label={`Header {{${i + 1}}}`}
                    error={fieldError(`samples.header.${i}`)}
                  >
                    <Input
                      value={draft.samples.header?.[i] ?? ''}
                      onChange={(e) => setSample('header', i, e.target.value)}
                    />
                  </Field>
                ))}
                {Array.from({ length: need.body }, (_, i) => (
                  <Field
                    key={`b${i}`}
                    label={`Message {{${i + 1}}}`}
                    error={fieldError(`samples.body.${i}`)}
                  >
                    <Input
                      value={draft.samples.body[i] ?? ''}
                      onChange={(e) => setSample('body', i, e.target.value)}
                    />
                  </Field>
                ))}
                {Object.keys(need.buttons).map((idx) => (
                  <Field
                    key={`u${idx}`}
                    label={`Website button ${Number(idx) + 1} {{1}}`}
                    error={fieldError(`samples.buttons.${idx}`)}
                  >
                    <Input
                      value={draft.samples.buttons?.[idx]?.[0] ?? ''}
                      onChange={(e) => setButtonSample(Number(idx), e.target.value)}
                    />
                  </Field>
                ))}
              </Section>
            ) : null}
          </>
        )}

        {warnings.length ? (
          <Alert tone="warning" title="Meta may reject or re-categorize this">
            <ul className="list-disc pl-5">
              {warnings.map((w) => (
                <li key={`${w.code}-${w.path}`}>{w.message}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
        {errors.length ? (
          <Alert
            tone="danger"
            title={`${errors.length} problem${errors.length === 1 ? '' : 's'} to fix before submitting`}
          >
            <ul className="list-disc pl-5">
              {errors.slice(0, 8).map((e) => (
                <li key={`${e.code}-${e.path}`}>{e.message}</li>
              ))}
            </ul>
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="secondary"
            loading={save.isPending && save.variables === 'save'}
            disabled={save.isPending || !draft.name || (!template && !account)}
          >
            Save draft
          </Button>
          {can('templates.submit') ? (
            <Button
              type="button"
              loading={save.isPending && save.variables === 'submit'}
              disabled={save.isPending || errors.length > 0 || (!template && !account)}
              onClick={() => save.mutate('submit')}
            >
              Submit for review
            </Button>
          ) : null}
        </div>
      </form>

      <aside className="lg:col-span-2" aria-label="Preview">
        <div className={cn('flex flex-col gap-2 lg:sticky lg:top-20')}>
          <h2 className="text-sm font-semibold text-slate">Preview</h2>
          <TemplatePreview components={c} samples={draft.samples} headerImageUrl={sampleUrl.data} />
        </div>
      </aside>
    </div>
  )
}

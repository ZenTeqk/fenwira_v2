'use client'
import {
  type DraftGraph,
  type Flow,
  type FlowIssue,
  type FlowVersion,
  REPLY_PRESETS,
  replyPreset,
  replyStudioSettingsSchema,
  type ReplyPresetId,
  validateFlowGraph,
} from '@fenwira/contracts'
import {
  Alert,
  Breadcrumb,
  Button,
  DetailPage,
  Drawer,
  DrawerContent,
  Field,
  Input,
  PermissionState,
  Textarea,
} from '@fenwira/ui'
import { ArrowLeft, ArrowRight, Check, GitBranch, Smartphone } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRef, useState } from 'react'
import { useSession } from '@/components/session/session-provider'
import { ApiError, errorText, get, patch, post, put } from '@/lib/api/client'
import { autoLayout, NODE_LABEL, type DraftNode } from '@/lib/automation'
import { useConnections } from '@/lib/workspace-status'
import { Choose } from './choose'
import { ReplyNodeFields } from './node-fields'
import { ReplyTestPhone } from './test-phone'
import { ReplyPhonePreview } from './phone-preview'
import { MiniChat } from './starter-cards'
const STEPS = [
  'Starter flow',
  'Trigger and number',
  'Messages and options',
  'Questions and fields',
  'Fallback and handover',
  'Test flow',
  'Publish',
]
const HELP = [
  'Choose an editable starting point. Starter flows are conversation recipes, separate from Meta message templates.',
  'Choose what starts the reply and which WhatsApp number receives it.',
  'Write what customers see and offer simple choices.',
  'Ask for the details your team needs. Save answers in named enquiry fields, with optional contact property mapping.',
  'Choose how to handle invalid answers, inactivity and the handover to a person.',
  'Walk through the phone preview with sample answers before publishing.',
  'Publish the saved version when the test is complete. Running conversations keep their original version.',
]
export function ReplyWizard() {
  const params = useSearchParams(),
    router = useRouter(),
    { can } = useSession(),
    connections = useConnections()
  const kind = params.get('kind') === 'AUTO_REPLY' ? 'AUTO_REPLY' : 'BOT_FLOW'
  const initialPreset = REPLY_PRESETS.find((p) => p.id === params.get('preset') && p.kind === kind)
  const [step, setStep] = useState(0),
    [previewOpen, setPreviewOpen] = useState(false),
    [name, setName] = useState(initialPreset?.title ?? ''),
    [selected, setSelected] = useState<ReplyPresetId | null>(initialPreset?.id ?? null),
    [graph, setGraph] = useState<DraftGraph>(() => replyPreset(initialPreset?.id ?? 'blank', kind)),
    [phone, setPhone] = useState(''),
    [tested, setTested] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [serverIssues, setServerIssues] = useState<FlowIssue[]>([])
  const flowId = useRef<string | null>(null)
  const numbers = (connections.data ?? []).filter((n) =>
    ['CONNECTED', 'FLAGGED'].includes(n.status),
  )
  const chosenPhone = phone || (numbers.length === 1 ? numbers[0]!.id : '')
  const title = kind === 'AUTO_REPLY' ? 'Create Auto Reply' : 'Create Bot Flow'
  function update(g: DraftGraph) {
    setServerIssues([])
    setGraph(g)
    setTested(false)
  }
  function config(node: DraftNode, c: Record<string, unknown>) {
    update({
      ...graph,
      nodes: graph.nodes.map((n) => (n.id === node.id ? { ...n, config: c } : n)),
    })
  }
  const trigger = graph.nodes.find((n) => n.type.startsWith('trigger.'))!
  const settings = graph.replyStudio ?? replyStudioSettingsSchema.parse({ kind })
  const localValidation = validateFlowGraph(graph)
  const validation = {
    valid: localValidation.valid && serverIssues.length === 0,
    errors: [...localValidation.errors, ...serverIssues],
  }
  async function save() {
    if (!name.trim()) throw new Error('Give this reply or flow a name in the first step.')
    let numberId = chosenPhone
    if (!numberId) {
      const fresh = (
        await get<{ data: Array<{ id: string; status: string }> }>('/whatsapp/connections')
      ).data.filter((n) => ['CONNECTED', 'FLAGGED'].includes(n.status))
      if (fresh.length === 1) numberId = fresh[0]!.id
    }
    if (!numberId) throw new Error('Choose a connected WhatsApp number in Trigger and number.')
    if (!flowId.current)
      flowId.current = (
        await post<{ data: Flow }>('/flows', {
          name: name.trim(),
          managedBy: 'REPLY_STUDIO',
          reentryPolicy: 'AFTER_COMPLETION',
        })
      ).data.id
    const id = flowId.current
    await patch(`/flows/${id}`, { name: name.trim() })
    const draft = (await get<{ data: FlowVersion }>(`/flows/${id}/draft`)).data
    let enquiryTag: string | undefined
    if (
      selected === 'product-enquiry' &&
      can('contacts.write') &&
      graph.nodes.some(
        (n) => n.type === 'action.handover' && !(n.config.tagIds as string[])?.length,
      )
    ) {
      const tags = (await get<{ data: Array<{ id: string; name: string }> }>('/tags')).data
      enquiryTag = tags.find((t) => t.name === 'Product enquiry')?.id
      if (!enquiryTag)
        enquiryTag = (await post<{ data: { id: string } }>('/tags', { name: 'Product enquiry' }))
          .data.id
    }
    const compiled = autoLayout({
      ...graph,
      nodes: graph.nodes.map((n) =>
        n.id === trigger.id
          ? { ...n, config: { ...n.config, phoneNumberIds: [numberId], caseSensitive: false } }
          : n.type === 'action.handover' && enquiryTag && !(n.config.tagIds as string[])?.length
            ? { ...n, config: { ...n.config, tagIds: [enquiryTag] } }
            : n,
      ),
    })
    await put(`/flows/${id}/draft`, { graph: compiled }, { headers: { 'If-Match': draft.etag } })
    return id
  }
  const targetStep = (id?: string) => {
    const n = graph.nodes.find((n) => n.id === id)
    return !n
      ? 0
      : n.type.startsWith('trigger.')
        ? 1
        : n.type === 'action.question'
          ? 3
          : n.type === 'action.handover'
            ? 4
            : 2
  }
  const nodeForm = (n: DraftNode) => (
    <fieldset
      key={n.id}
      id={`setup-${n.id}`}
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
    >
      <legend className="px-2 text-sm font-semibold text-slate">
        {NODE_LABEL[n.type]} · {n.id.replaceAll('_', ' ')}
      </legend>
      {n.type === 'action.send_message' ? (
        <Field label="Message" hint="Use {{vars.field_name}} to include a collected answer.">
          <Textarea
            value={String(n.config.text ?? '')}
            onChange={(e) => config(n, { ...n.config, text: e.target.value })}
          />
        </Field>
      ) : (
        <ReplyNodeFields node={n} onChange={(c) => config(n, c)} />
      )}
    </fieldset>
  )
  if (!can('automations.write')) return <PermissionState what="Reply Studio" />
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Breadcrumb
        className="md:hidden"
        items={[{ label: 'Reply Studio', href: '/automations/reply-studio' }, { label: title }]}
        linkAs={Link}
      />
      <DetailPage
        header={{
          title,
          description:
            'Answer common questions, guide customer enquiries, and connect customers with your team.',
          actions: (
            <Button variant="secondary" className="lg:hidden" onClick={() => setPreviewOpen(true)}>
              <Smartphone aria-hidden="true" />
              Preview
            </Button>
          ),
        }}
      >
        <div className="grid min-w-0 gap-6 lg:grid-cols-12">
          <nav aria-label="Setup steps" className="min-w-0 lg:col-span-12 xl:col-span-3">
            <p className="mb-4 text-xs font-medium uppercase tracking-wide text-muted">
              Step {step + 1} of {STEPS.length}
            </p>
            <ol className="flex gap-2 overflow-x-auto pb-2 xl:flex-col">
              {STEPS.map((label, i) => (
                <li key={label} className="shrink-0">
                  <Button
                    variant="ghost"
                    className={`h-auto min-h-12 w-full justify-start gap-4 px-4 py-2 text-left ${step === i ? 'bg-primary-soft text-primary-strong' : 'text-secondary'}`}
                    aria-current={step === i ? 'step' : undefined}
                    aria-label={`Step ${i + 1}: ${label}`}
                    onClick={() => setStep(i)}
                  >
                    <span
                      aria-hidden="true"
                      className={`flex size-6 shrink-0 items-center justify-center rounded-full border text-xs ${step === i ? 'border-primary-strong bg-primary-strong text-surface' : 'border-border-strong bg-surface text-secondary'}`}
                    >
                      {i < step ? <Check className="size-3" /> : i + 1}
                    </span>
                    <span>{label}</span>
                  </Button>
                </li>
              ))}
            </ol>
          </nav>
          <section className="flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-surface p-4 md:p-6 lg:col-span-7 xl:col-span-5">
            <div className="border-b border-border pb-4">
              <h2 className="text-lg font-semibold text-slate">{STEPS[step]}</h2>
              <p className="mt-2 text-sm text-secondary">{HELP[step]}</p>
            </div>
            {error ? (
              <Alert tone="danger" title="Setup needs attention">
                {error}
              </Alert>
            ) : null}
            {step === 0 ? (
              <>
                <Field label="Name">
                  <Input
                    value={name}
                    maxLength={120}
                    onChange={(e) => {
                      setName(e.target.value)
                      setTested(false)
                    }}
                  />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
                  {[
                    ...REPLY_PRESETS.filter((p) => p.kind === kind),
                    {
                      id: 'blank' as const,
                      title: 'Blank flow',
                      help: 'Write your own replies and questions.',
                    },
                  ].map((p) => (
                    <Button
                      key={p.id}
                      variant="secondary"
                      className={`h-auto flex-col items-stretch gap-4 whitespace-normal rounded-lg p-4 text-left hover:bg-surface hover:shadow-raised ${selected === p.id ? 'border-primary bg-primary-soft' : 'border-border bg-surface hover:border-border-strong'}`}
                      aria-pressed={selected === p.id}
                      onClick={() => {
                        setSelected(p.id)
                        update(replyPreset(p.id, kind))
                        if (!name) setName(p.title)
                      }}
                    >
                      <MiniChat preset={p.id} />
                      <span className="flex items-center gap-2 text-md font-semibold">
                        <GitBranch className="size-4" aria-hidden="true" />
                        {p.title}
                      </span>
                      <span className="text-sm font-normal text-secondary">{p.help}</span>
                    </Button>
                  ))}
                </div>
              </>
            ) : null}
            {step === 1 ? (
              <>
                <Choose
                  label="Start when"
                  value={trigger.type}
                  onChange={(v) =>
                    update({
                      ...graph,
                      nodes: graph.nodes.map((n) =>
                        n.id === trigger.id
                          ? {
                              ...n,
                              type: v as DraftNode['type'],
                              config:
                                v === 'trigger.keyword'
                                  ? { keywords: ['enquiry'], match: 'EXACT', caseSensitive: false }
                                  : { onlyNewConversation: true, cooldownHours: 24 },
                            }
                          : n,
                      ),
                    })
                  }
                  options={[
                    { value: 'trigger.keyword', label: 'A keyword matches' },
                    { value: 'trigger.message_received', label: 'A customer message arrives' },
                  ]}
                />
                {trigger.type === 'trigger.keyword' ? (
                  <>
                    <Field
                      label="Keywords and spellings"
                      hint="Separate spellings with commas. Matching ignores case and punctuation."
                    >
                      <Input
                        value={((trigger.config.keywords as string[]) ?? []).join(', ')}
                        onChange={(e) =>
                          config(trigger, {
                            ...trigger.config,
                            keywords: e.target.value.split(',').map((s) => s.trim()),
                          })
                        }
                      />
                    </Field>
                    <Choose
                      label="Keyword match"
                      value={String(trigger.config.match ?? 'EXACT')}
                      onChange={(v) => config(trigger, { ...trigger.config, match: v })}
                      options={[
                        { value: 'EXACT', label: 'Exact phrase' },
                        { value: 'WHOLE_WORD', label: 'Whole word' },
                        { value: 'CONTAINS', label: 'Contains' },
                        { value: 'STARTS_WITH', label: 'Starts with' },
                      ]}
                    />
                  </>
                ) : (
                  <>
                    <Choose
                      label="Conversation messages"
                      value={trigger.config.onlyNewConversation ? 'FIRST' : 'ALL'}
                      onChange={(v) =>
                        config(trigger, { ...trigger.config, onlyNewConversation: v === 'FIRST' })
                      }
                      options={[
                        { value: 'FIRST', label: 'First message of a new conversation' },
                        { value: 'ALL', label: 'Every message' },
                      ]}
                    />
                    {trigger.config.onlyNewConversation ? (
                      <Field label="Per-contact cooldown (hours)">
                        <Input
                          type="number"
                          min={0}
                          max={8760}
                          value={Number(trigger.config.cooldownHours ?? 24)}
                          onChange={(e) =>
                            config(trigger, {
                              ...trigger.config,
                              cooldownHours: Number(e.target.value),
                            })
                          }
                        />
                      </Field>
                    ) : null}
                  </>
                )}
                {connections.isError ? (
                  <Alert
                    tone="danger"
                    title="Could not load WhatsApp numbers"
                    action={
                      <Button variant="secondary" onClick={() => void connections.refetch()}>
                        Retry
                      </Button>
                    }
                  >
                    {errorText(connections.error)}
                  </Alert>
                ) : numbers.length === 1 ? (
                  <p className="text-sm text-secondary">
                    WhatsApp number: {numbers[0]!.displayPhoneNumber}
                  </p>
                ) : (
                  <Choose
                    label="WhatsApp number"
                    value={chosenPhone}
                    onChange={(v) => {
                      setPhone(v)
                      setTested(false)
                    }}
                    options={numbers.map((n) => ({ value: n.id, label: n.displayPhoneNumber }))}
                  />
                )}
                {!connections.isPending && !numbers.length ? (
                  <Alert tone="warning" title="Connect a WhatsApp number">
                    Connect a number in Settings before publishing this flow.
                  </Alert>
                ) : null}
                <Choose
                  label="Business hours filter"
                  value={String(trigger.config.businessHours ?? 'ANY')}
                  onChange={(v) => config(trigger, { ...trigger.config, businessHours: v })}
                  options={[
                    { value: 'ANY', label: 'Any time' },
                    { value: 'OPEN', label: 'Only during business hours' },
                    { value: 'CLOSED', label: 'Only outside business hours' },
                  ]}
                />
                <Link
                  className="text-sm text-primary-strong underline"
                  href="/automations/reply-studio/business-hours"
                >
                  Edit workspace business hours
                </Link>
              </>
            ) : null}
            {step === 2
              ? graph.nodes
                  .filter((n) => n.type === 'action.send_message' || n.type === 'action.options')
                  .map(nodeForm)
              : null}
            {step === 3 ? (
              <>
                {graph.nodes.filter((n) => n.type === 'action.question').map(nodeForm)}
                {!graph.nodes.some((n) => n.type === 'action.question') ? (
                  <p className="text-sm text-secondary">
                    This starter does not collect typed answers. You can add questions in the canvas
                    after saving.
                  </p>
                ) : null}
              </>
            ) : null}
            {step === 4 ? (
              <>
                <Field
                  label="Fallback message"
                  hint="Offers a person after invalid answers; sent at most once per conversation every 24 hours."
                >
                  <Textarea
                    value={settings.fallbackMessage}
                    onChange={(e) =>
                      update({
                        ...graph,
                        replyStudio: { ...settings, fallbackMessage: e.target.value },
                      })
                    }
                  />
                </Field>
                <Field
                  label="Inactivity expiry (minutes)"
                  hint="Up to 1440 minutes, capped by the WhatsApp reply window."
                >
                  <Input
                    type="number"
                    min={1}
                    max={1440}
                    value={settings.expiryMinutes}
                    onChange={(e) =>
                      update({
                        ...graph,
                        replyStudio: { ...settings, expiryMinutes: Number(e.target.value) },
                      })
                    }
                  />
                </Field>
                <Field
                  label="Optional closing message"
                  hint="Sent on expiry only while the customer is still eligible for a reply."
                >
                  <Textarea
                    value={settings.closingMessage}
                    onChange={(e) =>
                      update({
                        ...graph,
                        replyStudio: { ...settings, closingMessage: e.target.value },
                      })
                    }
                  />
                </Field>
                <Field
                  label="Restart words"
                  hint="Comma-separated words that end the current session and start fresh."
                >
                  <Input
                    value={settings.restartWords.join(', ')}
                    onChange={(e) =>
                      update({
                        ...graph,
                        replyStudio: {
                          ...settings,
                          restartWords: e.target.value.split(',').map((s) => s.trim()),
                        },
                      })
                    }
                  />
                </Field>
                {graph.nodes.filter((n) => n.type === 'action.handover').map(nodeForm)}
              </>
            ) : null}
            {step === 5 ? (
              <div className="rounded-lg bg-neutral-soft p-4 text-sm text-secondary">
                <p className="font-medium text-slate">Try it as a customer</p>
                <p className="mt-2">
                  Use the phone preview to answer each question and review the handover. No customer
                  messages are sent.
                </p>
                <Button
                  className="mt-4 lg:hidden"
                  variant="secondary"
                  onClick={() => setPreviewOpen(true)}
                >
                  <Smartphone aria-hidden="true" />
                  Preview
                </Button>
              </div>
            ) : null}
            {step === 6 ? (
              <>
                <p className="text-sm text-secondary">
                  {tested
                    ? 'The complete sample conversation passed. You can publish this flow.'
                    : 'Complete Test flow before publishing.'}
                </p>
                {!validation.valid ? (
                  <ul className="flex flex-col gap-2">
                    {validation.errors.map((issue, i) => (
                      <li
                        key={i}
                        className="flex flex-wrap items-center gap-2 text-sm text-danger-strong"
                      >
                        {issue.nodeId
                          ? `${NODE_LABEL[graph.nodes.find((n) => n.id === issue.nodeId)!.type]} (${issue.nodeId}): `
                          : ''}
                        {issue.message}
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setStep(targetStep(issue.nodeId))}
                        >
                          Fix
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : null}
          </section>
          <aside
            aria-label="Live phone preview"
            className="hidden min-w-0 flex-col items-center gap-4 lg:col-span-5 lg:flex xl:col-span-4"
          >
            <div className="flex w-full items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate">
                {step === 5 ? 'Test your flow' : 'Live preview'}
              </h2>
              <span className="text-xs text-muted">Sample conversation</span>
            </div>
            {step === 5 ? (
              <ReplyTestPhone graph={graph} save={save} onTested={() => setTested(true)} />
            ) : (
              <ReplyPhonePreview graph={graph} />
            )}
            <p className="text-center text-xs text-muted">
              {step === 5
                ? 'Nothing is sent to a real customer.'
                : 'Your changes appear here as you write.'}
            </p>
          </aside>
        </div>
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-surface p-4">
          <Button variant="secondary" disabled={step === 0} onClick={() => setStep(step - 1)}>
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back
          </Button>
          <Button
            variant="secondary"
            loading={busy}
            onClick={async () => {
              setBusy(true)
              try {
                const id = await save()
                router.push(`/automations/${id}/edit`)
              } catch (e) {
                setError(errorText(e, e instanceof Error ? e.message : 'Could not save.'))
              } finally {
                setBusy(false)
              }
            }}
          >
            Save draft
          </Button>
          {step < STEPS.length - 1 ? (
            <Button
              onClick={() => {
                setError('')
                if (step === 0 && (!selected || !name.trim())) {
                  setError('Choose a starter flow and enter a name.')
                  return
                }
                setStep(step + 1)
              }}
            >
              Next
              <ArrowRight aria-hidden="true" className="size-4" />
            </Button>
          ) : null}
          {step === STEPS.length - 1 ? (
            <Button
              disabled={!tested || !validation.valid || !can('automations.publish')}
              loading={busy}
              onClick={async () => {
                setBusy(true)
                setError('')
                try {
                  const id = await save()
                  await post(
                    `/flows/${id}/publish`,
                    {},
                    { headers: { 'Idempotency-Key': crypto.randomUUID() } },
                  )
                  router.push('/automations/reply-studio')
                } catch (e) {
                  if (e instanceof ApiError && Array.isArray(e.details?.errors))
                    setServerIssues(e.details.errors as FlowIssue[])
                  setError(errorText(e, e instanceof Error ? e.message : 'Could not publish.'))
                } finally {
                  setBusy(false)
                }
              }}
            >
              Publish
            </Button>
          ) : null}
        </div>
      </DetailPage>
      <Drawer open={previewOpen} onOpenChange={setPreviewOpen}>
        <DrawerContent title={step === 5 ? 'Test flow' : 'Live preview'}>
          {step === 5 ? (
            <ReplyTestPhone graph={graph} save={save} onTested={() => setTested(true)} />
          ) : (
            <div className="flex justify-center">
              <ReplyPhonePreview graph={graph} />
            </div>
          )}
        </DrawerContent>
      </Drawer>
    </div>
  )
}

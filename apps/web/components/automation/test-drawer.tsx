'use client'

import {
  type Contact,
  type NodeType,
  type FlowTestRequest,
  type FlowTestResult,
} from '@fenwira/contracts'
import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  DrawerContent,
  Field,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  SearchInput,
  StatusBadge,
  Textarea,
} from '@fenwira/ui'
import { useMutation, useQuery } from '@tanstack/react-query'
import { CheckCircle2, FlaskConical } from 'lucide-react'
import { useId, useState } from 'react'
import { useSession } from '@/components/session/session-provider'
import { ApiError, post } from '@/lib/api/client'
import { automationKey, type DraftNode, NODE_LABEL } from '@/lib/automation'
import { useTags } from '@/lib/contacts'

type Props = {
  flowId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: DraftNode | undefined
  /** Saves pending draft edits first; the test runs the saved draft. */
  beforeRun: () => Promise<boolean>
  result: FlowTestResult | null
  onResult: (result: FlowTestResult | null) => void
  /** Why the flow can't be tested yet (validation problems), if any. */
  blocked?: string
}

/** A body with the phone at the trigger's path: `customer.phone` → {customer: {phone: …}}. */
function samplePayload(path: string): string {
  const body: Record<string, unknown> = {}
  let cur = body
  const parts = path.split('.').filter(Boolean)
  parts.forEach((p, i) => {
    if (i === parts.length - 1) cur[p] = '+919876543210'
    else cur = (cur[p] = {}) as Record<string, unknown>
  })
  if (!parts.includes('order')) body.order = { id: '1001', status: 'Shipped' }
  return JSON.stringify(body, null, 2)
}

/**
 * Test run drawer (docs/AUTOMATION_ENGINE.md → Test run): a sample contact and event run through
 * the saved draft as a dry run. Nothing is sent, tagged, changed or called; each step says what
 * would happen and why a condition went Yes or No, and the builder highlights the path.
 */
export function TestDrawer({
  flowId,
  open,
  onOpenChange,
  trigger,
  beforeRun,
  result,
  onResult,
  blocked,
}: Props) {
  const { tenantId } = useSession()
  const ids = useId()
  const tags = useTags()
  const config = (trigger?.config ?? {}) as Record<string, unknown>
  const [who, setWho] = useState<'sample' | 'existing'>('sample')
  const [name, setName] = useState('Asha')
  const [phone, setPhone] = useState('')
  const [tagIds, setTagIds] = useState<string[]>([])
  const [q, setQ] = useState('')
  const [contactId, setContactId] = useState<string | null>(null)
  const firstKeyword = Array.isArray(config.keywords) ? String(config.keywords[0] ?? '') : ''
  const [message, setMessage] = useState(firstKeyword || 'Hi, what are your prices?')
  const [payload, setPayload] = useState(() =>
    samplePayload(String(config.contactPhonePath ?? 'phone')),
  )
  const [error, setError] = useState<string>()

  const contacts = useQuery({
    queryKey: automationKey(tenantId, 'test-contacts', q),
    queryFn: () =>
      post<{ data: Contact[] }>('/contacts/search', { q: q || undefined, limit: 8 }).then(
        (r) => r.data,
      ),
    enabled: open && who === 'existing',
  })

  const run = useMutation({
    mutationFn: async () => {
      if (!(await beforeRun())) throw new Error('Save your changes before testing.')
      const body: FlowTestRequest = {}
      if (who === 'existing') {
        if (!contactId) throw new Error('Choose a contact.')
        body.contactId = contactId
      } else
        body.contact = {
          name: name.trim() || undefined,
          phone: phone.trim() || undefined,
          tagIds,
        }
      if (trigger?.type === 'trigger.keyword' || trigger?.type === 'trigger.message_received')
        body.message = message
      if (trigger?.type === 'trigger.webhook') {
        try {
          body.webhook = JSON.parse(payload) as Record<string, unknown>
        } catch {
          throw new Error('The sample payload is not valid JSON.')
        }
      }
      return (await post<{ data: FlowTestResult }>(`/flows/${flowId}/test`, body)).data
    },
    onMutate: () => setError(undefined),
    onSuccess: onResult,
    onError: (e) =>
      setError(
        e instanceof ApiError
          ? (e.field('contact.phone') ?? e.message)
          : e instanceof Error
            ? e.message
            : 'The test could not run.',
      ),
  })

  const messageTrigger =
    trigger?.type === 'trigger.keyword' || trigger?.type === 'trigger.message_received'
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        title="Test this automation"
        description="A dry run with sample data: nothing is sent, tagged, changed or called."
        width="lg"
      >
        <div className="flex flex-col gap-5">
          {blocked ? (
            <Alert tone="warning" title="Fix the automation first">
              {blocked}
            </Alert>
          ) : null}
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-sm font-semibold text-slate">Sample contact</legend>
            <RadioGroup
              value={who}
              onValueChange={(v) => setWho(v as 'sample' | 'existing')}
              className="flex flex-wrap gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem id={`${ids}-sample`} value="sample" />
                <Label htmlFor={`${ids}-sample`}>Make one up</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem id={`${ids}-existing`} value="existing" />
                <Label htmlFor={`${ids}-existing`}>One of your contacts</Label>
              </div>
            </RadioGroup>
            {who === 'sample' ? (
              <div className="flex flex-col gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Name">
                    <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
                  </Field>
                  <Field label="Phone (optional)" hint="With country code, e.g. +91…">
                    <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
                  </Field>
                </div>
                {tags.data?.length ? (
                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-1 text-sm font-medium text-slate">
                      Tags the contact already has
                    </legend>
                    <div className="flex flex-wrap gap-x-4 gap-y-2">
                      {tags.data.map((t) => (
                        <div key={t.id} className="flex items-center gap-2">
                          <Checkbox
                            id={`${ids}-tag-${t.id}`}
                            checked={tagIds.includes(t.id)}
                            onCheckedChange={(c) =>
                              setTagIds(c ? [...tagIds, t.id] : tagIds.filter((x) => x !== t.id))
                            }
                          />
                          <Label htmlFor={`${ids}-tag-${t.id}`}>{t.name}</Label>
                        </div>
                      ))}
                    </div>
                  </fieldset>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <SearchInput
                  label="Search contacts"
                  value={q}
                  onValueChange={setQ}
                  className="sm:w-full"
                />
                <RadioGroup
                  aria-label="Contact"
                  value={contactId ?? ''}
                  onValueChange={setContactId}
                  className="flex flex-col gap-2"
                >
                  {(contacts.data ?? []).map((c) => (
                    <div key={c.id} className="flex items-center gap-2">
                      <RadioGroupItem id={`${ids}-c-${c.id}`} value={c.id} />
                      <Label htmlFor={`${ids}-c-${c.id}`}>
                        {c.name ?? 'Unnamed'}{' '}
                        <span className="font-mono text-xs text-muted">{c.phoneE164}</span>
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
                {contacts.data && !contacts.data.length ? (
                  <p className="text-sm text-muted">No contacts found.</p>
                ) : null}
              </div>
            )}
          </fieldset>

          {messageTrigger ? (
            <Field label="Incoming message" hint="What the customer sends on WhatsApp.">
              <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} />
            </Field>
          ) : trigger?.type === 'trigger.webhook' ? (
            <Field label="Webhook payload (JSON)" hint="What your system would send.">
              <Textarea
                value={payload}
                onChange={(e) => setPayload(e.target.value)}
                rows={8}
                className="font-mono text-xs"
              />
            </Field>
          ) : (
            <p className="text-sm text-secondary">
              The test runs as if this contact had just been added.
            </p>
          )}

          {error ? (
            <Alert tone="danger" title="The test didn’t run">
              {error}
            </Alert>
          ) : null}
          <div>
            <Button onClick={() => run.mutate()} loading={run.isPending} disabled={!!blocked}>
              <FlaskConical aria-hidden="true" />
              Run test
            </Button>
          </div>

          {result ? <TestResult result={result} /> : null}
        </div>
      </DrawerContent>
    </Drawer>
  )
}

function TestResult({ result }: { result: FlowTestResult }) {
  if (!result.matched)
    return (
      <Alert tone="warning" title="This sample wouldn’t start the automation">
        {result.reason}
      </Alert>
    )
  return (
    <section aria-labelledby="test-result-title" className="flex flex-col gap-3">
      <h3 id="test-result-title" className="text-sm font-semibold text-slate">
        What would happen
      </h3>
      <p className="inline-flex items-center gap-2 text-sm text-secondary">
        <CheckCircle2 className="size-4 text-success-strong" aria-hidden="true" />
        Dry run: no message was sent, no tag or contact changed, no webhook or AI was called.
      </p>
      <ol aria-label="Test steps" className="flex flex-col gap-2">
        {result.steps.map((s, i) => (
          <li
            key={`${s.nodeId}-${i}`}
            className="flex flex-col gap-1 rounded-md border border-border bg-surface p-3"
          >
            <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate">
              {i + 1}. {NODE_LABEL[s.nodeType as NodeType] ?? s.nodeType}
              {s.status === 'FAILED' ? <StatusBadge status="FAILED" /> : null}
            </span>
            <span className="text-sm whitespace-pre-wrap text-secondary">{s.summary}</span>
          </li>
        ))}
      </ol>
      {result.truncated ? (
        <p className="text-sm text-secondary">
          The test stopped after {result.steps.length} steps. Check the flow for a loop.
        </p>
      ) : null}
    </section>
  )
}

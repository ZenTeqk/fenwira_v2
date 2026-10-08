'use client'

import {
  type FlowIssue,
  type Member,
  OPERATORS,
  requiredVariables,
  type WebhookToken,
} from '@fenwira/contracts'
import {
  Alert,
  Button,
  Checkbox,
  Field,
  Input,
  Label,
  Modal,
  ModalContent,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
  toast,
} from '@fenwira/ui'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { useSession } from '@/components/session/session-provider'
import { ApiError, get, post } from '@/lib/api/client'
import { automationKey, type DraftNode, EXPRESSION_PATHS, NODE_LABEL } from '@/lib/automation'
import { useProperties, useTags } from '@/lib/contacts'
import { useApprovedTemplates, useTemplateSampleUrl } from '@/lib/templates'
import { TemplatePhonePreview } from '@/components/templates/template-phone-preview'
import { NODE_HINT, NodeSymbol } from './node-presentation'

type Config = Record<string, unknown>
type Props = {
  flowId: string
  node: DraftNode
  issues: FlowIssue[]
  readOnly?: boolean
  onChange: (config: Config) => void
  onDelete: () => void
}

const str = (v: unknown) =>
  typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v)
const CONTACT_SOURCES = ['INBOUND', 'MANUAL', 'IMPORT', 'API', 'CAMPAIGN', 'AUTOMATION'] as const

/** Appends a `{{value}}` token to a text field (keyboard-friendly select). */
function InsertValue({ onInsert, label }: { onInsert: (token: string) => void; label: string }) {
  return (
    <Select value="" onValueChange={(p) => onInsert(`{{${p}}}`)}>
      <SelectTrigger aria-label={`Insert a value into ${label}`} className="w-44">
        <SelectValue placeholder="Insert value" />
      </SelectTrigger>
      <SelectContent>
        {EXPRESSION_PATHS.map((p) => (
          <SelectItem key={p.path} value={p.path}>
            {p.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function TextWithValues(props: {
  label: string
  value: string
  onChange: (v: string) => void
  multiline?: boolean
  hint?: string
  readOnly?: boolean
}) {
  const Control = props.multiline ? Textarea : Input
  return (
    <div className="flex flex-col gap-2">
      <Field label={props.label} hint={props.hint}>
        <Control
          value={props.value}
          className={props.multiline ? 'min-h-40' : undefined}
          readOnly={props.readOnly}
          onChange={(e: { target: { value: string } }) => props.onChange(e.target.value)}
        />
      </Field>
      {props.readOnly ? null : (
        <InsertValue label={props.label} onInsert={(t) => props.onChange(`${props.value}${t}`)} />
      )}
    </div>
  )
}

function Choose(props: {
  label: string
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
  placeholder?: string
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{props.label}</Label>
      <Select
        value={props.value || undefined}
        onValueChange={props.onChange}
        disabled={props.disabled}
      >
        <SelectTrigger id={id}>
          <SelectValue placeholder={props.placeholder ?? 'Choose…'} />
        </SelectTrigger>
        <SelectContent>
          {props.options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function Toggle(props: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={id}>{props.label}</Label>
      <Switch
        id={id}
        checked={props.checked}
        onCheckedChange={props.onChange}
        disabled={props.disabled}
      />
    </div>
  )
}

function TagChecklist(props: {
  value: string[]
  onChange: (v: string[]) => void
  disabled?: boolean
}) {
  const tags = useTags()
  if (!tags.data?.length)
    return <p className="text-sm text-muted">Create tags in Contacts first.</p>
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium text-slate">Tags</legend>
      {tags.data.map((t) => {
        const id = `tag-${t.id}`
        const on = props.value.includes(t.id)
        return (
          <div key={t.id} className="flex items-center gap-2">
            <Checkbox
              id={id}
              checked={on}
              disabled={props.disabled}
              onCheckedChange={(c) =>
                props.onChange(c ? [...props.value, t.id] : props.value.filter((x) => x !== t.id))
              }
            />
            <Label htmlFor={id}>{t.name}</Label>
          </div>
        )
      })}
    </fieldset>
  )
}

/** Keeps the raw text while typing (commas stay); the parsed list goes to the config. */
function KeywordsField(props: {
  value: string[]
  onChange: (v: string[]) => void
  readOnly?: boolean
}) {
  const [raw, setRaw] = useState(props.value.join(', '))
  return (
    <Field label="Keywords" hint="Separate with commas.">
      <Input
        readOnly={props.readOnly}
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value)
          props.onChange(
            e.target.value
              .split(',')
              .map((k) => k.trim())
              .filter(Boolean),
          )
        }}
      />
    </Field>
  )
}

function WebhookTokenPanel({ flowId }: { flowId: string }) {
  const [token, setToken] = useState<WebhookToken | null>(null)
  const rotate = useMutation({
    mutationFn: () => post<{ data: WebhookToken }>(`/flows/${flowId}/webhook-token`),
    onSuccess: (r) => setToken(r.data),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not create the URL.'),
  })
  return (
    <div className="flex flex-col gap-2">
      <Button variant="secondary" onClick={() => rotate.mutate()} loading={rotate.isPending}>
        Create webhook URL
      </Button>
      <p className="text-sm text-muted">Creating a new URL stops the previous one from working.</p>
      <Modal open={!!token} onOpenChange={(o) => !o && setToken(null)}>
        <ModalContent
          title="Webhook URL and signing secret"
          description="Copy both now. The secret isn't shown again."
        >
          <div className="flex flex-col gap-3">
            <Field label="URL">
              <Input readOnly value={token?.url ?? ''} />
            </Field>
            <Field
              label="Signing secret"
              hint="Send X-Fenwira-Signature: sha256=HMAC-SHA256(secret, raw body)."
            >
              <Input readOnly value={token?.secret ?? ''} />
            </Field>
          </div>
        </ModalContent>
      </Modal>
    </div>
  )
}

/** Side panel with the form for the selected step (docs/AUTOMATION_ENGINE.md → Node catalog). */
export function NodeInspector({ flowId, node, issues, readOnly, onChange, onDelete }: Props) {
  const { tenantId, can } = useSession()
  const c = node.config as Config
  const set = (patch: Config) => onChange({ ...c, ...patch })
  const properties = useProperties()
  const templates = useApprovedTemplates(undefined, node.type === 'action.send_template')
  const chosenTemplate = templates.data?.find((t) => t.templateId === c.templateId)
  const header = chosenTemplate?.components.header
  const sample = useTemplateSampleUrl(
    header && header.format !== 'TEXT' ? header.sampleFileId : null,
  )
  const members = useQuery({
    queryKey: automationKey(tenantId, 'members'),
    queryFn: () => get<{ data: Member[] }>('/team/members').then((r) => r.data),
    enabled: node.type === 'action.assign_agent' && can('team.read'),
  })

  let form: React.ReactNode = null
  switch (node.type) {
    case 'trigger.keyword':
      form = (
        <>
          <KeywordsField
            readOnly={readOnly}
            value={(c.keywords as string[]) ?? []}
            onChange={(keywords) => set({ keywords })}
          />
          <Choose
            label="Match"
            value={str(c.match) || 'EXACT'}
            disabled={readOnly}
            onChange={(v) => set({ match: v })}
            options={[
              { value: 'EXACT', label: 'The whole message' },
              { value: 'CONTAINS', label: 'Anywhere in the message' },
              { value: 'STARTS_WITH', label: 'Start of the message' },
            ]}
          />
          <Toggle
            label="Match upper and lower case exactly"
            checked={!!c.caseSensitive}
            disabled={readOnly}
            onChange={(v) => set({ caseSensitive: v })}
          />
        </>
      )
      break
    case 'trigger.message_received':
      form = (
        <Toggle
          label="Only the first message of a conversation"
          checked={!!c.onlyNewConversation}
          disabled={readOnly}
          onChange={(v) => set({ onlyNewConversation: v })}
        />
      )
      break
    case 'trigger.contact_created': {
      const sources = (c.sources as string[] | undefined) ?? []
      form = (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-slate">
            Only contacts added from (none = any)
          </legend>
          {CONTACT_SOURCES.map((s) => (
            <div key={s} className="flex items-center gap-2">
              <Checkbox
                id={`src-${s}`}
                checked={sources.includes(s)}
                disabled={readOnly}
                onCheckedChange={(on) =>
                  set({ sources: on ? [...sources, s] : sources.filter((x) => x !== s) })
                }
              />
              <Label htmlFor={`src-${s}`}>{s.charAt(0) + s.slice(1).toLowerCase()}</Label>
            </div>
          ))}
        </fieldset>
      )
      break
    }
    case 'trigger.webhook':
      form = (
        <>
          <Field
            label="Phone number field"
            hint="Where the phone is in the JSON body, e.g. customer.phone"
          >
            <Input
              readOnly={readOnly}
              value={str(c.contactPhonePath)}
              onChange={(e) => set({ contactPhonePath: e.target.value })}
            />
          </Field>
          <Toggle
            label="Require a signature"
            checked={c.requireSignature !== false}
            disabled={readOnly}
            onChange={(v) => set({ requireSignature: v })}
          />
          {readOnly || !can('automations.write') ? null : <WebhookTokenPanel flowId={flowId} />}
        </>
      )
      break
    case 'condition.equals':
    case 'condition.contains':
      form = (
        <>
          <TextWithValues
            label="Value to check"
            readOnly={readOnly}
            value={str(c.subject)}
            onChange={(v) => set({ subject: v })}
          />
          <TextWithValues
            label={node.type === 'condition.equals' ? 'Equals' : 'Contains'}
            readOnly={readOnly}
            value={str(c.value)}
            onChange={(v) => set({ value: v })}
          />
          <Toggle
            label="Match upper and lower case exactly"
            checked={!!c.caseSensitive}
            disabled={readOnly}
            onChange={(v) => set({ caseSensitive: v })}
          />
        </>
      )
      break
    case 'condition.exists':
      form = (
        <TextWithValues
          label="Value to check"
          readOnly={readOnly}
          value={str(c.subject)}
          onChange={(v) => set({ subject: v })}
        />
      )
      break
    case 'condition.has_tag':
      form = (
        <>
          <TagChecklist
            value={(c.tagIds as string[]) ?? []}
            disabled={readOnly}
            onChange={(v) => set({ tagIds: v })}
          />
          <Choose
            label="Contact must have"
            value={str(c.match) || 'ANY'}
            disabled={readOnly}
            onChange={(v) => set({ match: v })}
            options={[
              { value: 'ANY', label: 'Any of these tags' },
              { value: 'ALL', label: 'All of these tags' },
            ]}
          />
        </>
      )
      break
    case 'condition.contact_property':
      form = (
        <>
          <Choose
            label="Field"
            value={str(c.key)}
            disabled={readOnly}
            onChange={(v) => set({ key: v })}
            options={[
              { value: 'name', label: 'Name' },
              { value: 'email', label: 'Email' },
              { value: 'language', label: 'Language' },
              { value: 'country', label: 'Country' },
              ...(properties.data ?? []).map((p) => ({ value: p.key, label: p.label })),
            ]}
          />
          <Choose
            label="Condition"
            value={str(c.operator)}
            disabled={readOnly}
            onChange={(v) => set({ operator: v })}
            options={OPERATORS.map((o) => ({
              value: o,
              label: o.charAt(0) + o.slice(1).toLowerCase().replaceAll('_', ' '),
            }))}
          />
          <Field label="Value">
            <Input
              readOnly={readOnly}
              value={str(c.value)}
              onChange={(e) => set({ value: e.target.value })}
            />
          </Field>
        </>
      )
      break
    case 'action.send_message':
      form = (
        <TextWithValues
          label="Message"
          multiline
          readOnly={readOnly}
          hint="Sent as a WhatsApp message. Outside the 24-hour window, use a template instead."
          value={str(c.text)}
          onChange={(v) => set({ text: v })}
        />
      )
      break
    case 'action.send_template': {
      const chosen = templates.data?.find((t) => t.templateId === c.templateId)
      const need = chosen ? requiredVariables(chosen.components) : null
      const vars = (c.variables as { body?: string[]; header?: string[] }) ?? { body: [] }
      const setVar = (part: 'body' | 'header', i: number, v: string) => {
        const arr = [...(vars[part] ?? [])]
        arr[i] = v
        set({ variables: { ...vars, [part]: arr } })
      }
      form = (
        <>
          <Choose
            label="Template"
            value={str(c.templateId)}
            disabled={readOnly}
            placeholder={templates.isPending ? 'Loading…' : 'Choose an approved template'}
            onChange={(v) => set({ templateId: v, variables: { body: [] } })}
            options={(templates.data ?? [])
              .filter((t, i, all) => all.findIndex((x) => x.templateId === t.templateId) === i)
              .map((t) => ({ value: t.templateId, label: `${t.name} (${t.language})` }))}
          />
          {chosen ? (
            <p className="rounded-sm bg-neutral-soft p-3 text-sm text-slate">
              {chosen.components.body.text}
            </p>
          ) : null}
          {Array.from({ length: need?.header ?? 0 }, (_, i) => (
            <TextWithValues
              key={`h${i}`}
              label={`Header value {{${i + 1}}}`}
              readOnly={readOnly}
              value={str(vars.header?.[i])}
              onChange={(v) => setVar('header', i, v)}
            />
          ))}
          {Array.from({ length: need?.body ?? 0 }, (_, i) => (
            <TextWithValues
              key={`b${i}`}
              label={`Body value {{${i + 1}}}`}
              readOnly={readOnly}
              value={str(vars.body?.[i])}
              onChange={(v) => setVar('body', i, v)}
            />
          ))}
        </>
      )
      break
    }
    case 'action.add_tag':
    case 'action.remove_tag':
      form = (
        <TagChecklist
          value={(c.tagIds as string[]) ?? []}
          disabled={readOnly}
          onChange={(v) => set({ tagIds: v })}
        />
      )
      break
    case 'action.assign_agent':
      form = (
        <>
          <Choose
            label="Assign to"
            value={str(c.mode) || 'ROUND_ROBIN'}
            disabled={readOnly}
            onChange={(v) =>
              set({ mode: v, ...(v === 'ROUND_ROBIN' ? { userId: undefined } : {}) })
            }
            options={[
              { value: 'ROUND_ROBIN', label: 'Whoever is online (round robin)' },
              { value: 'USER', label: 'A specific teammate' },
            ]}
          />
          {c.mode === 'USER' ? (
            <Choose
              label="Teammate"
              value={str(c.userId)}
              disabled={readOnly}
              onChange={(v) => set({ userId: v })}
              options={(members.data ?? [])
                .filter((m) => m.status === 'ACTIVE' && m.role !== 'VIEWER')
                .map((m) => ({ value: m.userId, label: m.name }))}
            />
          ) : null}
        </>
      )
      break
    case 'action.update_contact': {
      const updates = (c.updates as Array<{ field: string; value: string }>) ?? []
      const setRow = (i: number, patch: Partial<{ field: string; value: string }>) =>
        set({ updates: updates.map((u, j) => (j === i ? { ...u, ...patch } : u)) })
      form = (
        <div className="flex flex-col gap-4">
          {updates.map((u, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-sm border border-border p-3">
              <Choose
                label={`Field ${i + 1}`}
                value={u.field}
                disabled={readOnly}
                onChange={(v) => setRow(i, { field: v })}
                options={[
                  { value: 'name', label: 'Name' },
                  { value: 'email', label: 'Email' },
                  { value: 'language', label: 'Language' },
                  ...(properties.data ?? [])
                    .filter((p) => !p.archived)
                    .map((p) => ({ value: `property.${p.key}`, label: p.label })),
                ]}
              />
              <TextWithValues
                label={`New value ${i + 1}`}
                readOnly={readOnly}
                value={u.value}
                onChange={(v) => setRow(i, { value: v })}
              />
              {readOnly || updates.length === 1 ? null : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => set({ updates: updates.filter((_, j) => j !== i) })}
                >
                  <Trash2 aria-hidden="true" />
                  Remove field {i + 1}
                </Button>
              )}
            </div>
          ))}
          {readOnly ? null : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => set({ updates: [...updates, { field: 'name', value: '' }] })}
            >
              <Plus aria-hidden="true" />
              Add a field
            </Button>
          )}
        </div>
      )
      break
    }
    case 'action.webhook': {
      const headers = Object.entries((c.headers as Record<string, string>) ?? {})
      const setHeaders = (rows: Array<[string, string]>) =>
        set({ headers: Object.fromEntries(rows) })
      form = (
        <>
          <Choose
            label="Method"
            value={str(c.method) || 'POST'}
            disabled={readOnly}
            onChange={(v) => set({ method: v })}
            options={[
              { value: 'POST', label: 'POST' },
              { value: 'GET', label: 'GET' },
            ]}
          />
          <Field label="URL" hint="https only. Private and internal addresses are blocked.">
            <Input
              readOnly={readOnly}
              value={str(c.url)}
              onChange={(e) => set({ url: e.target.value })}
            />
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-slate">Headers</legend>
            {headers.map(([k, v], i) => (
              <div key={i} className="flex gap-2">
                <Input
                  aria-label={`Header ${i + 1} name`}
                  readOnly={readOnly}
                  value={k}
                  onChange={(e) =>
                    setHeaders(headers.map((h, j) => (j === i ? [e.target.value, h[1]] : h)))
                  }
                />
                <Input
                  aria-label={`Header ${i + 1} value`}
                  readOnly={readOnly}
                  value={v}
                  onChange={(e) =>
                    setHeaders(headers.map((h, j) => (j === i ? [h[0], e.target.value] : h)))
                  }
                />
              </div>
            ))}
            {readOnly ? null : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setHeaders([...headers, [`X-Header-${headers.length + 1}`, '']])}
              >
                <Plus aria-hidden="true" />
                Add a header
              </Button>
            )}
            <p className="text-sm text-muted">
              Secret headers (authorization, tokens, keys) are hidden in history.
            </p>
          </fieldset>
          {c.method !== 'GET' ? (
            <TextWithValues
              label="Body (JSON)"
              multiline
              readOnly={readOnly}
              value={str(c.body)}
              onChange={(v) => set({ body: v })}
            />
          ) : null}
          <Field label="Timeout (ms)" hint="500 to 10000">
            <Input
              type="number"
              readOnly={readOnly}
              value={str(c.timeoutMs)}
              onChange={(e) => set({ timeoutMs: Number(e.target.value) })}
            />
          </Field>
          <Field
            label="Save the response as"
            hint="Then use {{vars.name.body.field}} in later steps."
          >
            <Input
              readOnly={readOnly}
              value={str(c.saveResponseAs)}
              onChange={(e) => set({ saveResponseAs: e.target.value || undefined })}
            />
          </Field>
        </>
      )
      break
    }
    case 'action.delay':
      form = (
        <div className="flex gap-2">
          <Field label="Wait for" className="flex-1">
            <Input
              type="number"
              min={1}
              readOnly={readOnly}
              value={str(c.amount)}
              onChange={(e) => set({ amount: Number(e.target.value) })}
            />
          </Field>
          <div className="flex-1">
            <Choose
              label="Unit"
              value={str(c.unit) || 'HOURS'}
              disabled={readOnly}
              onChange={(v) => set({ unit: v })}
              options={[
                { value: 'MINUTES', label: 'Minutes' },
                { value: 'HOURS', label: 'Hours' },
                { value: 'DAYS', label: 'Days' },
              ]}
            />
          </div>
        </div>
      )
      break
    case 'action.end':
      form = <p className="text-sm text-muted">The automation finishes here.</p>
      break
  }

  return (
    <section aria-labelledby="inspector-title" className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <NodeSymbol type={node.type} />
          <h2 id="inspector-title" className="text-md font-semibold text-slate">
            {NODE_LABEL[node.type]}
          </h2>
        </div>
        {readOnly ? null : (
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            aria-label={`Delete step ${NODE_LABEL[node.type]}`}
          >
            <Trash2 aria-hidden="true" />
            Delete
          </Button>
        )}
      </div>
      {issues.length ? (
        <Alert tone="danger" title="Fix this step before publishing">
          <ul className="list-disc pl-4">
            {issues.map((i, k) => (
              <li key={k}>{i.message}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      <p className="text-sm text-secondary">{NODE_HINT[node.type]}</p>
      {form}
      {node.type === 'action.send_message' && typeof c.text === 'string' && c.text ? (
        <section
          aria-label="Message preview"
          className="flex flex-col gap-3 border-t border-border pt-4"
        >
          <h3 className="text-sm font-semibold text-slate">Preview</h3>
          <TemplatePhonePreview
            compact
            components={{ body: { text: c.text }, buttons: [] }}
            samples={{ body: [] }}
          />
          <p className="text-xs text-secondary">
            Expression markers are replaced with actual contact or event values when this step runs.
          </p>
        </section>
      ) : null}
      {node.type === 'action.send_template' && chosenTemplate ? (
        <section
          aria-label="Template preview"
          className="flex flex-col gap-3 border-t border-border pt-4"
        >
          <h3 className="text-sm font-semibold text-slate">Preview</h3>
          <TemplatePhonePreview
            compact
            components={chosenTemplate.components}
            samples={(c.variables as { body: string[]; header?: string[] }) ?? { body: [] }}
            headerImageUrl={sample.data}
          />
          <p className="text-xs text-secondary">
            The approved template version is resolved when this step runs. Expressions use actual
            event values.
          </p>
        </section>
      ) : null}
    </section>
  )
}

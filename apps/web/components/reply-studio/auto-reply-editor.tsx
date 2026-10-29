'use client'
import {
  type DraftGraph,
  type Flow,
  type FlowIssue,
  type FlowVersion,
  type Overlap,
  explainOverlap,
} from '@fenwira/contracts'
import {
  Alert,
  Button,
  DetailPage,
  Drawer,
  DrawerContent,
  Field,
  Input,
  Textarea,
} from '@fenwira/ui'
import Link from 'next/link'
import { useState } from 'react'
import { type DraftNode } from '@/lib/automation'
import { Choose } from './choose'
import { ReplyPhonePreview } from './phone-preview'
import { ReplyNodeFields } from './node-fields'
import { ReplyTestPhone } from './test-phone'
import { VersionState } from '@/components/automation/version-state'
import { FlowActivity } from '@/components/automation/flow-activity'
type Props = {
  flow: Flow
  draft: FlowVersion
  graph: DraftGraph
  onChange: (g: DraftGraph) => void
  onSave: () => Promise<boolean>
  onPublish: () => void
  onDiscard: () => void
  saveLabel: string
  readOnly: boolean
  canPublish: boolean
  issues: FlowIssue[]
  overlaps: Overlap[]
  onPriority: (v: number) => Promise<void>
  onName: (v: string) => void
  name: string
  busy?: boolean
}
export function AutoReplyEditor(p: Props) {
  const [preview, setPreview] = useState(false)
  const start = p.graph.nodes.find((n) => n.type.startsWith('trigger.'))
  const response = p.graph.nodes.find((n) => n.type === 'action.send_message')
  const handover = p.graph.nodes.find((n) => n.type === 'action.handover')
  const update = (node: DraftNode, config: Record<string, unknown>) =>
    p.onChange({
      ...p.graph,
      nodes: p.graph.nodes.map((n) => (n.id === node.id ? { ...n, config } : n)),
    })
  const c = start?.config ?? {}
  const [keyword, setKeyword] = useState('')
  const mode =
    start?.type === 'trigger.keyword'
      ? 'keyword'
      : p.graph.nodes.some((n) => n.type === 'condition.business_hours') ||
          c.businessHours === 'CLOSED'
        ? 'outside'
        : 'welcome'
  const setMode = (value: string) => {
    if (!start) return
    let nodes = p.graph.nodes.filter((n) => n.type !== 'condition.business_hours')
    const edges = p.graph.edges.filter(
      (e) =>
        !p.graph.nodes.some(
          (n) => n.type === 'condition.business_hours' && (e.source === n.id || e.target === n.id),
        ),
    )
    if (!edges.some((e) => e.source === start.id) && response)
      edges.push({
        id: `${start.id}-next`,
        source: start.id,
        target: response.id,
        sourceHandle: 'next',
      })
    nodes = nodes.map((n) =>
      n.id === start.id
        ? {
            ...n,
            type:
              value === 'keyword'
                ? ('trigger.keyword' as const)
                : ('trigger.message_received' as const),
            config:
              value === 'keyword'
                ? { keywords: ['price'], match: 'WHOLE_WORD', caseSensitive: false }
                : {
                    onlyNewConversation: value === 'welcome',
                    cooldownHours: 24,
                    businessHours: value === 'outside' ? 'CLOSED' : 'ANY',
                  },
          }
        : n,
    )
    p.onChange({ ...p.graph, nodes, edges })
  }
  const phone = (
    <div className="w-80 max-w-full">
      <ReplyPhonePreview graph={p.graph} />
    </div>
  )
  return (
    <div className="min-h-dvh bg-background p-4 md:p-6">
      <div className="mx-auto max-w-7xl">
        <DetailPage
          header={{
            title: p.name,
            description:
              'Auto reply · One rule and one response. Changes apply to new conversations after publishing.',
            actions: (
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="ghost">
                  <Link href="/automations/reply-studio/auto-replies">Auto Replies</Link>
                </Button>
                <FlowActivity flowId={p.flow.id} />
                <Button variant="secondary" className="lg:hidden" onClick={() => setPreview(true)}>
                  Preview
                </Button>
                <Button variant="secondary" onClick={() => void p.onSave()} disabled={p.readOnly}>
                  {p.saveLabel}
                </Button>
                <Button
                  onClick={p.onPublish}
                  disabled={
                    !p.canPublish ||
                    p.issues.length > 0 ||
                    p.readOnly ||
                    (!!p.flow.activeVersion && p.draft.state !== 'DRAFT' && p.saveLabel === 'Saved')
                  }
                  loading={p.busy}
                >
                  {p.flow.activeVersion ? 'Publish changes' : 'Publish'}
                </Button>
              </div>
            ),
          }}
        >
          <VersionState
            flow={p.flow}
            draft={p.draft}
            dirty={p.saveLabel !== 'Saved'}
            onDiscard={p.onDiscard}
            disabled={p.readOnly}
          />
          <div className="grid min-w-0 gap-6 lg:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-4">
              <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
                <h2 className="text-md font-semibold text-slate">Trigger</h2>
                <Field label="Name">
                  <Input
                    value={p.name}
                    readOnly={p.readOnly}
                    maxLength={120}
                    onChange={(e) => p.onName(e.target.value)}
                  />
                </Field>
                <Choose
                  label="Start when"
                  value={mode}
                  disabled={p.readOnly}
                  onChange={setMode}
                  options={[
                    { value: 'welcome', label: 'New conversation' },
                    { value: 'keyword', label: 'Keyword matches' },
                    { value: 'outside', label: 'Outside business hours' },
                  ]}
                />
              </section>
              {start?.type === 'trigger.keyword' ? (
                <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
                  <h2 className="text-md font-semibold text-slate">Keywords</h2>
                  <div className="flex flex-wrap gap-2">
                    {((c.keywords as string[]) ?? []).map((word, i) => (
                      <Button
                        key={`${word}-${i}`}
                        variant="secondary"
                        size="sm"
                        disabled={p.readOnly}
                        aria-label={`Remove keyword ${word}`}
                        onClick={() =>
                          update(start, {
                            ...c,
                            keywords: (c.keywords as string[]).filter((_, j) => j !== i),
                          })
                        }
                      >
                        {word} ×
                      </Button>
                    ))}
                  </div>
                  <form
                    className="flex items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (keyword.trim()) {
                        update(start, {
                          ...c,
                          keywords: [...((c.keywords as string[]) ?? []), keyword.trim()],
                        })
                        setKeyword('')
                      }
                    }}
                  >
                    <Field label="Add keyword">
                      <Input
                        value={keyword}
                        disabled={p.readOnly}
                        onChange={(e) => setKeyword(e.target.value)}
                        maxLength={100}
                      />
                    </Field>
                    <Button
                      type="submit"
                      variant="secondary"
                      disabled={!keyword.trim() || p.readOnly}
                    >
                      Add
                    </Button>
                  </form>
                  <Choose
                    label="Matching rule"
                    value={String(c.match ?? 'EXACT')}
                    disabled={p.readOnly}
                    onChange={(v) => update(start, { ...c, match: v })}
                    options={[
                      { value: 'EXACT', label: 'Exact phrase' },
                      { value: 'WHOLE_WORD', label: 'Whole word' },
                      { value: 'CONTAINS', label: 'Contains' },
                      { value: 'STARTS_WITH', label: 'Starts with' },
                    ]}
                  />
                  <p className="text-xs text-muted">Case-insensitive; punctuation is ignored.</p>
                </section>
              ) : null}
              {response ? (
                <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
                  <h2 className="text-md font-semibold text-slate">Response</h2>
                  <Field label="Reply message">
                    <Textarea
                      rows={4}
                      value={String(response.config.text ?? '')}
                      readOnly={p.readOnly}
                      onChange={(e) =>
                        update(response, { ...response.config, text: e.target.value })
                      }
                    />
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    {['contact.firstName', 'contact.name'].map((v) => (
                      <Button
                        key={v}
                        variant="secondary"
                        size="sm"
                        disabled={p.readOnly}
                        onClick={() =>
                          update(response, {
                            ...response.config,
                            text: `${response.config.text ?? ''}{{${v}}}`,
                          })
                        }
                      >{`{{${v}}}`}</Button>
                    ))}
                  </div>
                </section>
              ) : (
                <Alert tone="warning" title="Response step missing">
                  Open the canvas to add a Message step.
                </Alert>
              )}
              <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
                <h2 className="text-md font-semibold text-slate">Behaviour</h2>
                {start ? (
                  <>
                    <Choose
                      label="Business hours"
                      value={mode === 'outside' ? 'CLOSED' : String(c.businessHours ?? 'ANY')}
                      disabled={p.readOnly || mode === 'outside'}
                      onChange={(v) => update(start, { ...c, businessHours: v })}
                      options={[
                        { value: 'ANY', label: 'Any time' },
                        { value: 'OPEN', label: 'Only during business hours' },
                        { value: 'CLOSED', label: 'Only outside business hours' },
                      ]}
                    />
                    {mode === 'outside' ? (
                      <p className="text-xs text-muted">
                        The workspace schedule and holidays decide when this reply runs.
                      </p>
                    ) : null}
                    {start.type === 'trigger.message_received' && c.onlyNewConversation ? (
                      <Field label="Contact cooldown (hours)">
                        <Input
                          type="number"
                          min={0}
                          max={8760}
                          value={Number(c.cooldownHours ?? 24)}
                          readOnly={p.readOnly}
                          onChange={(e) =>
                            update(start, { ...c, cooldownHours: Number(e.target.value) })
                          }
                        />
                      </Field>
                    ) : (
                      <p className="text-xs text-muted">
                        Contact cooldown applies to New conversation replies.
                      </p>
                    )}
                  </>
                ) : null}
                <Field
                  label="Priority"
                  hint="Lower numbers run first. This ordering setting applies when saved."
                >
                  <Input
                    type="number"
                    min={0}
                    max={100000}
                    defaultValue={p.flow.priority}
                    disabled={p.readOnly}
                    onBlur={(e) => {
                      const value = Number(e.target.value)
                      if (Number.isInteger(value) && value >= 0 && value <= 100000)
                        void p.onPriority(value)
                    }}
                  />
                </Field>
                {handover ? (
                  <ReplyNodeFields
                    node={handover}
                    onChange={(config) => update(handover, config)}
                    readOnly={p.readOnly}
                  />
                ) : (
                  <>
                    <p className="text-sm text-secondary">
                      This reply leaves the conversation available to the shared inbox. Add a
                      handover to route it to your team.
                    </p>
                    <Button
                      variant="secondary"
                      disabled={p.readOnly || !response}
                      onClick={() => {
                        if (!response) return
                        const id = crypto.randomUUID()
                        p.onChange({
                          ...p.graph,
                          nodes: [
                            ...p.graph.nodes,
                            {
                              id,
                              type: 'action.handover',
                              config: {
                                tagIds: [],
                                note: 'Auto reply enquiry: {{trigger.message.text}}',
                              },
                            },
                          ],
                          edges: [
                            ...p.graph.edges.map((e) =>
                              e.source === response.id && e.sourceHandle === 'next'
                                ? { ...e, target: id }
                                : e,
                            ),
                            {
                              id: `${id}-next`,
                              source: id,
                              target:
                                p.graph.edges.find(
                                  (e) => e.source === response.id && e.sourceHandle === 'next',
                                )?.target ?? 'end',
                              sourceHandle: 'next',
                            },
                          ],
                        })
                      }}
                    >
                      Add handover
                    </Button>
                  </>
                )}
              </section>
              {p.overlaps.length ? (
                <Alert tone="warning" title="Overlapping rules">
                  <ul className="flex flex-col gap-2">
                    {p.overlaps.map((o) => (
                      <li key={o.flow.id}>{explainOverlap(o, p.flow)}</li>
                    ))}
                  </ul>
                </Alert>
              ) : null}
              {p.issues.length ? (
                <Alert tone="danger" title="Fix before publishing">
                  <ul>
                    {p.issues.map((i, j) => (
                      <li key={j} className="flex flex-wrap items-center gap-2">
                        {i.message}
                        <Button asChild variant="ghost" size="sm">
                          <Link
                            href={`/automations/${p.flow.id}/edit?canvas=1${i.nodeId ? `&node=${encodeURIComponent(i.nodeId)}` : ''}`}
                          >
                            Fix
                          </Link>
                        </Button>
                      </li>
                    ))}
                  </ul>
                </Alert>
              ) : null}
              <details className="rounded-lg border border-border bg-surface p-4">
                <summary className="text-md font-semibold text-slate">Test</summary>
                <div className="mt-4">
                  <ReplyTestPhone
                    graph={p.graph}
                    compact
                    save={async () => {
                      if (!(await p.onSave())) throw new Error('Save changes before testing.')
                      return p.flow.id
                    }}
                  />
                </div>
              </details>
              <Button asChild variant="ghost" className="self-start">
                <Link href={`/automations/${p.flow.id}/edit?canvas=1`}>Open full canvas</Link>
              </Button>
            </div>
            <aside
              aria-label="Live phone preview"
              className="hidden min-w-0 flex-col items-center gap-4 lg:flex"
            >
              <h2 className="text-sm font-semibold text-slate">Live preview</h2>
              {phone}
            </aside>
          </div>
        </DetailPage>
      </div>
      <Drawer open={preview} onOpenChange={setPreview}>
        <DrawerContent title="Live preview">{phone}</DrawerContent>
      </Drawer>
    </div>
  )
}

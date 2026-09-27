'use client'

import {
  type DraftGraph,
  type FlowIssue,
  isTrigger,
  type NodeType,
  validateFlowGraph,
} from '@fenwira/contracts'
import {
  Alert,
  Button,
  PageHeader,
  Skeleton,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from '@fenwira/ui'
import { useQueryClient } from '@tanstack/react-query'
import { History, LayoutGrid, Pause, Play, Rocket } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from '@/components/session/session-provider'
import { ApiError, post, put } from '@/lib/api/client'
import {
  addNode,
  autoLayout,
  automationKey,
  categoryOf,
  NODE_LABEL,
  PALETTE,
  removeNode,
  useDraft,
  useFlow,
} from '@/lib/automation'
import { FlowCanvas } from './flow-canvas'
import { FlowOutline } from './flow-outline'
import { NodeInspector } from './node-inspector'
import { ValidationPanel } from './validation-panel'

type SaveState = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error'
const SAVE_LABEL: Record<SaveState, string> = {
  saved: 'All changes saved',
  dirty: 'Unsaved changes',
  saving: 'Saving…',
  conflict: 'Someone else changed this flow',
  error: 'Could not save',
}
/** Server-only checks (they need the workspace's data); kept from the last save. */
const SERVER_CODES = new Set(['FLOW_REFERENCE_MISSING', 'FLOW_TEMPLATE_NOT_APPROVED'])

/** The flow builder: canvas or outline, palette, inspector and live validation. */
export function FlowBuilder({ flowId }: { flowId: string }) {
  const { tenantId, can } = useSession()
  const qc = useQueryClient()
  const flow = useFlow(flowId)
  const draft = useDraft(flowId)
  const editable = can('automations.write') && flow.data?.status !== 'ARCHIVED'
  const [graph, setGraph] = useState<DraftGraph | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [save, setSave] = useState<SaveState>('saved')
  const [serverIssues, setServerIssues] = useState<FlowIssue[]>([])
  const etag = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pending = useRef<DraftGraph | null>(null)
  // The canvas needs room; phones start in the keyboard-friendly Outline (UX_PATTERNS → Responsive).
  const [view, setView] = useState('canvas')
  useEffect(() => {
    if (window.matchMedia('(max-width: 767px)').matches) setView('outline')
  }, [])

  useEffect(() => {
    if (draft.data && graph === null) {
      setGraph(draft.data.graph)
      etag.current = draft.data.etag
      setServerIssues(
        (draft.data.validation?.errors ?? []).filter((e) =>
          SERVER_CODES.has(e.code),
        ) as FlowIssue[],
      )
    }
  }, [draft.data, graph])

  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    const g = pending.current
    if (!g || !etag.current) return true
    pending.current = null
    setSave('saving')
    try {
      const r = await put<{ data: { etag: string; validation: { errors: FlowIssue[] } | null } }>(
        `/flows/${flowId}/draft`,
        { graph: g },
        { headers: { 'If-Match': etag.current } },
      )
      etag.current = r.data.etag
      setServerIssues((r.data.validation?.errors ?? []).filter((e) => SERVER_CODES.has(e.code)))
      setSave(pending.current ? 'dirty' : 'saved')
      return true
    } catch (e) {
      if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') setSave('conflict')
      else {
        pending.current ??= g
        setSave('error')
      }
      return false
    }
  }, [flowId])

  const change = useCallback(
    (g: DraftGraph) => {
      setGraph(g)
      pending.current = g
      setSave('dirty')
      clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), 800)
    },
    [flush],
  )
  useEffect(() => () => clearTimeout(timer.current), [])

  const issues = useMemo(() => {
    if (!graph) return []
    return [...validateFlowGraph(graph).errors, ...serverIssues]
  }, [graph, serverIssues])

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: automationKey(tenantId, 'flow', flowId) })
    void qc.invalidateQueries({ queryKey: automationKey(tenantId, 'flows') })
  }

  const [publishing, setPublishing] = useState(false)
  async function publish() {
    setPublishing(true)
    try {
      if (!(await flush())) return
      await post(
        `/flows/${flowId}/publish`,
        {},
        { headers: { 'Idempotency-Key': crypto.randomUUID() } },
      )
      toast.success('Published. New conversations use this version.')
      refresh()
      void qc.invalidateQueries({ queryKey: automationKey(tenantId, 'draft', flowId) })
    } catch (e) {
      if (e instanceof ApiError && e.code === 'FLOW_INVALID') {
        setServerIssues(
          ((e.details?.errors as FlowIssue[]) ?? []).filter((x) => SERVER_CODES.has(x.code)),
        )
        toast.error('Fix the highlighted steps before publishing.')
      } else toast.error(e instanceof ApiError ? e.message : 'Could not publish.')
    } finally {
      setPublishing(false)
    }
  }

  async function setStatus(action: 'pause' | 'resume') {
    try {
      await post(`/flows/${flowId}/${action}`)
      toast.success(action === 'pause' ? 'Paused. No new runs start.' : 'Active again.')
      refresh()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not change the status.')
    }
  }

  function add(type: NodeType) {
    if (!graph) return
    const after =
      selected && !graph.nodes.find((n) => n.id === selected && n.type === 'action.end')
        ? selected
        : undefined
    const r = addNode(graph, type, isTrigger(type) ? undefined : after)
    change(r.graph)
    setSelected(r.id)
  }

  if (flow.isPending || draft.isPending || !graph)
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  if (!flow.data) return null
  const f = flow.data
  const node = graph.nodes.find((n) => n.id === selected) ?? null
  const hasTrigger = graph.nodes.some((n) => isTrigger(n.type))

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={f.name}
        breadcrumbs={[{ label: 'Automations', href: '/automations' }, { label: f.name }]}
        linkAs={Link}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge status={f.status} />
            {f.activeVersion ? (
              <span>Live version {f.activeVersion}</span>
            ) : (
              <span>Not published yet</span>
            )}
            <span aria-live="polite" className="text-sm">
              · {SAVE_LABEL[save]}
            </span>
          </span>
        }
        actions={
          <>
            <Button variant="secondary" asChild>
              <Link href={`/automations/${flowId}/history`}>
                <History aria-hidden="true" />
                History
              </Link>
            </Button>
            {can('automations.publish') && f.status === 'ACTIVE' ? (
              <Button variant="secondary" onClick={() => void setStatus('pause')}>
                <Pause aria-hidden="true" />
                Pause
              </Button>
            ) : null}
            {can('automations.publish') && f.status === 'PAUSED' ? (
              <Button variant="secondary" onClick={() => void setStatus('resume')}>
                <Play aria-hidden="true" />
                Resume
              </Button>
            ) : null}
            {can('automations.publish') && editable ? (
              <Button
                onClick={() => void publish()}
                loading={publishing}
                disabled={issues.length > 0}
              >
                <Rocket aria-hidden="true" />
                Publish
              </Button>
            ) : null}
          </>
        }
      />
      {save === 'conflict' ? (
        <Alert
          tone="warning"
          title="This flow was changed somewhere else"
          action={
            <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
              Reload
            </Button>
          }
        >
          Your latest change wasn’t saved. Reload to see the current version.
        </Alert>
      ) : null}
      <Tabs value={view} onValueChange={setView}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList aria-label="Builder view">
            <TabsTrigger value="canvas">Canvas</TabsTrigger>
            <TabsTrigger value="outline">Outline</TabsTrigger>
          </TabsList>
          {editable ? (
            <Button variant="ghost" size="sm" onClick={() => change(autoLayout(graph))}>
              <LayoutGrid aria-hidden="true" />
              Tidy layout
            </Button>
          ) : null}
        </div>
        <div className="mt-3 flex flex-col gap-4 lg:flex-row">
          {editable ? (
            <nav aria-label="Add a step" className="hidden shrink-0 flex-col gap-3 md:flex lg:w-52">
              {PALETTE.filter((g) => g.category !== 'trigger' || !hasTrigger).map((g) => (
                <div key={g.title} className="flex flex-col gap-1">
                  <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">
                    {g.title}
                  </h2>
                  {g.types.map((t) => (
                    <Button
                      key={t}
                      variant="secondary"
                      size="sm"
                      className="justify-start"
                      data-category={categoryOf(t)}
                      onClick={() => add(t)}
                    >
                      {NODE_LABEL[t]}
                    </Button>
                  ))}
                </div>
              ))}
            </nav>
          ) : null}
          <div className="min-w-0 flex-1">
            <TabsContent value="canvas" className="h-160">
              <div className="flex h-full flex-col items-center justify-center gap-3 rounded-md border border-border bg-surface p-6 text-center md:hidden">
                <p className="text-base text-slate">The canvas needs a larger screen.</p>
                <Button variant="secondary" onClick={() => setView('outline')}>
                  Use the outline
                </Button>
              </div>
              <div className="hidden h-full md:block">
                <FlowCanvas
                  graph={graph}
                  issues={issues}
                  selectedId={selected}
                  onSelect={setSelected}
                  onChange={editable ? change : undefined}
                  readOnly={!editable}
                />
              </div>
            </TabsContent>
            <TabsContent value="outline">
              <FlowOutline
                graph={graph}
                issues={issues}
                selectedId={selected}
                onSelect={setSelected}
                onChange={change}
                readOnly={!editable}
              />
            </TabsContent>
            <div className="mt-4 rounded-md border border-border bg-surface p-4">
              <ValidationPanel graph={graph} issues={issues} onSelect={setSelected} />
            </div>
          </div>
          <aside
            aria-label="Step settings"
            className="shrink-0 rounded-md border border-border bg-surface p-4 lg:w-80"
          >
            {node ? (
              <NodeInspector
                key={node.id}
                flowId={flowId}
                node={node}
                issues={issues.filter((i) => i.nodeId === node.id)}
                readOnly={!editable}
                onChange={(config) =>
                  change({
                    ...graph,
                    nodes: graph.nodes.map((n) => (n.id === node.id ? { ...n, config } : n)),
                  })
                }
                onDelete={() => {
                  change(removeNode(graph, node.id))
                  setSelected(null)
                }}
              />
            ) : (
              <p className="text-sm text-muted">
                {hasTrigger
                  ? 'Select a step to change its settings.'
                  : 'Start by choosing what triggers this automation.'}
              </p>
            )}
          </aside>
        </div>
      </Tabs>
    </div>
  )
}

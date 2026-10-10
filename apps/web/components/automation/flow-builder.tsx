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
  BuilderPage,
  ErrorState,
  Modal,
  ModalContent,
  Skeleton,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
  useConfirm,
} from '@fenwira/ui'
import { useQueryClient } from '@tanstack/react-query'
import { History, LayoutGrid, Pause, Play, Rocket, Save, PanelLeft } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from '@/components/session/session-provider'
import { ApiError, post, put } from '@/lib/api/client'
import { addNode, autoLayout, automationKey, removeNode, useDraft, useFlow } from '@/lib/automation'
import { FlowCanvas } from './flow-canvas'
import { FlowOutline } from './flow-outline'
import { NodeInspector } from './node-inspector'
import { ValidationPanel } from './validation-panel'
import { NodeLibrary } from './node-library'

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
  const confirm = useConfirm()
  const [wide, setWide] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1280px)')
    const update = () => setWide(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  const flow = useFlow(flowId)
  const draft = useDraft(flowId)
  const editable = can('automations.write') && flow.data?.status !== 'ARCHIVED'
  const [graph, setGraph] = useState<DraftGraph | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const inspectorOpener = useRef<HTMLElement | null>(null)
  function selectStep(id: string | null) {
    if (id)
      inspectorOpener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null
    setSelected(id)
  }
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
    if (
      !(await confirm({
        title: 'Publish this automation?',
        description: 'New matching events will use this version.',
        impact: [
          'The saved draft becomes the active published version.',
          'Existing runs stay on the version they started with.',
        ],
        confirmLabel: 'Publish automation',
      }))
    )
      return
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

  if (flow.isError || draft.isError)
    return (
      <ErrorState
        title="This automation couldn’t be loaded"
        onRetry={() => {
          void flow.refetch()
          void draft.refetch()
        }}
      />
    )
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

  const inspector = node ? (
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
    <div className="flex flex-col gap-2">
      <h2 className="text-md font-semibold text-slate">Step settings</h2>
      <p className="text-sm text-secondary">
        {hasTrigger
          ? 'Select a step on the canvas or outline to inspect its settings.'
          : 'Choose a trigger from Add step to start your automation.'}
      </p>
    </div>
  )
  return (
    <>
      <BuilderPage
        appearance="studio"
        header={{
          title: f.name,
          breadcrumbs: [{ label: 'Automations', href: '/automations' }, { label: f.name }],
          linkAs: Link,
          description: (
            <span className="flex flex-col gap-2">
              {f.description ? <span>{f.description}</span> : null}
              <span className="inline-flex flex-wrap items-center gap-2">
                <StatusBadge status={f.status} />
                <span>
                  {f.activeVersion ? `Live version ${f.activeVersion}` : 'Not published yet'}
                </span>
                <span aria-live="polite" className="text-sm">
                  · {SAVE_LABEL[save]}
                </span>
                <span>
                  · {f.executions.total.toLocaleString('en-IN')} total runs ·{' '}
                  {f.executions.running.toLocaleString('en-IN')} running
                </span>
              </span>
            </span>
          ),
          actions: (
            <>
              {editable ? (
                <Button
                  variant="secondary"
                  onClick={() => void flush()}
                  disabled={save !== 'dirty' && save !== 'error'}
                  loading={save === 'saving'}
                >
                  <Save aria-hidden="true" />
                  Save
                </Button>
              ) : null}
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
          ),
        }}
        banner={
          save === 'conflict' ? (
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
          ) : save === 'error' ? (
            <Alert
              tone="danger"
              title="Changes couldn’t be saved"
              action={
                <Button variant="secondary" size="sm" onClick={() => void flush()}>
                  Try again
                </Button>
              }
            >
              Your changes are still in this editor. Retry saving before leaving.
            </Alert>
          ) : undefined
        }
        palette={
          editable ? (
            <div className="hidden lg:block">
              <NodeLibrary hasTrigger={hasTrigger} onAdd={add} />
            </div>
          ) : undefined
        }
        inspector={wide ? inspector : undefined}
      >
        <Tabs value={view} onValueChange={setView}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2">
            <TabsList aria-label="Builder view" className="w-auto border-b-0">
              <TabsTrigger value="canvas">Canvas</TabsTrigger>
              <TabsTrigger value="outline">Outline</TabsTrigger>
            </TabsList>
            {editable ? (
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  className="lg:hidden"
                  onClick={() => setLibraryOpen(true)}
                >
                  <PanelLeft aria-hidden="true" />
                  Add step
                </Button>
                <Button variant="ghost" size="sm" onClick={() => change(autoLayout(graph))}>
                  <LayoutGrid aria-hidden="true" />
                  Tidy layout
                </Button>
              </div>
            ) : null}
          </div>
          <TabsContent value="canvas" className="mt-0 h-120 xl:h-136">
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center md:hidden">
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
                onSelect={selectStep}
                onChange={editable ? change : undefined}
                readOnly={!editable}
              />
            </div>
          </TabsContent>
          <TabsContent value="outline" className="p-3">
            <FlowOutline
              graph={graph}
              issues={issues}
              selectedId={selected}
              onSelect={selectStep}
              onChange={change}
              readOnly={!editable}
            />
          </TabsContent>
        </Tabs>
        <div className="border-t border-border bg-surface p-4">
          <ValidationPanel graph={graph} issues={issues} onSelect={selectStep} />
        </div>
      </BuilderPage>
      <Modal open={!wide && !!node} onOpenChange={(open) => !open && setSelected(null)}>
        <ModalContent
          title="Step settings"
          description="Configure the selected automation step."
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            const opener = inspectorOpener.current
            if (opener?.isConnected && opener !== document.body) opener.focus()
            else
              document
                .querySelector<HTMLElement>('[aria-label="Builder view"] [aria-selected="true"]')
                ?.focus()
          }}
        >
          {inspector}
        </ModalContent>
      </Modal>
      <Modal open={libraryOpen} onOpenChange={setLibraryOpen}>
        <ModalContent title="Add a step" description="Choose a supported step for this flow.">
          <NodeLibrary
            hasTrigger={hasTrigger}
            onAdd={(type) => {
              add(type)
              setLibraryOpen(false)
            }}
          />
        </ModalContent>
      </Modal>
    </>
  )
}

'use client'

import {
  type DraftGraph,
  type EdgeHandle,
  findOverlaps,
  type FlowIssue,
  type FlowVersion,
  type FlowTestResult,
  type Member,
  isTrigger,
  type NodeType,
  triggerOf,
  validateFlowGraph,
} from '@fenwira/contracts'
import {
  Alert,
  Button,
  BuilderPage,
  ErrorState,
  Drawer,
  DrawerContent,
  Input,
  Tooltip,
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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  CircleHelp,
  ChevronUp,
  ChevronDown,
  BarChart3,
  FlaskConical,
  History,
  LayoutGrid,
  Pause,
  PanelLeft,
  Play,
  Smartphone,
  Rocket,
  Settings2,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from '@/components/session/session-provider'
import { ApiError, del, get, patch, post, put } from '@/lib/api/client'
import {
  addNode,
  addTrigger,
  autoLayout,
  automationKey,
  insertNode,
  removeNode,
  setupChecklist,
  useDraft,
  useFlow,
  useFlows,
  useNodeStats,
} from '@/lib/automation'
import { describeFlow } from '@/lib/automation-summary'
import { useTags } from '@/lib/contacts'
import { useApprovedTemplates } from '@/lib/templates'
import { AddStepMenu } from './add-step-menu'
import { FlowCanvas } from './flow-canvas'
import { FlowOutline } from './flow-outline'
import { FlowSettings } from './flow-settings'
import { LivePreview } from './live-preview'
import { NodeInspector } from './node-inspector'
import { NodeLibrary } from './node-library'
import { overlapSentence, PublishedDialog, ReadinessPanel } from './readiness-panel'
import { SetupPanel } from './setup-panel'
import { ReplyTestPhone } from '@/components/reply-studio/test-phone'
import { VersionState } from './version-state'
import { AutoReplyEditor } from '@/components/reply-studio/auto-reply-editor'
import { FlowActivity } from './flow-activity'
import { CollectedAnswersPreview } from '@/components/reply-studio/collected-answers-preview'
import { TestDrawer } from './test-drawer'

type SaveState = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error'
const SAVE_LABEL: Record<SaveState, string> = {
  saved: 'Saved',
  dirty: 'Unsaved changes',
  saving: 'Saving...',
  conflict: 'Someone else changed this flow',
  error: "Couldn't save, retry",
}
/** Server-only checks (they need the workspace's data); kept from the last save. */
const SERVER_CODES = new Set(['FLOW_REFERENCE_MISSING', 'FLOW_TEMPLATE_NOT_APPROVED'])

/**
 * The flow builder: a plain-language summary, canvas or outline, palette, inspector, the setup
 * checklist, dry-run tests and the publish-readiness panel.
 */
export function FlowBuilder({ flowId }: { flowId: string }) {
  const { tenantId, can, me } = useSession()
  const router = useRouter()
  const search = useSearchParams()
  const preferenceKey = `fenwira.canvas.${me.user.id}.${tenantId}`
  const [libraryCollapsed, setLibraryCollapsed] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [rightTab, setRightTab] = useState('settings')
  function togglePreview(open: boolean) {
    setPreviewOpen(open)
    setRightTab(open ? 'preview' : 'settings')
    try {
      localStorage.setItem(`${preferenceKey}.preview`, String(open))
    } catch {
      /* Optional preference. */
    }
  }
  const [mobile, setMobile] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [name, setName] = useState<string | null>(null)
  const namePending = useRef<string | null>(null)
  useEffect(() => {
    try {
      setLibraryCollapsed(localStorage.getItem(`${preferenceKey}.library`) === 'true')
      const preview = localStorage.getItem(`${preferenceKey}.preview`) === 'true'
      setPreviewOpen(preview)
      setRightTab(preview ? 'preview' : 'settings')
    } catch {
      /* Optional preference. */
    }
    const media = window.matchMedia('(max-width: 767px)')
    const update = () => setMobile(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [preferenceKey])
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
  useEffect(() => {
    const id = search.get('node')
    if (id && graph?.nodes.some((n) => n.id === id)) {
      setSelected(id)
      setRightTab('settings')
    }
  }, [search, graph?.nodes.length])
  const inspectorOpener = useRef<HTMLElement | null>(null)
  function selectStep(id: string | null) {
    if (id)
      inspectorOpener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null
    setSelected(id)
    if (!previewOpen) setRightTab('settings')
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
  // Set by the template gallery (?template=…): the checklist uses the template's own steps.
  const [templateId, setTemplateId] = useState<string | null>(null)
  useEffect(() => {
    setTemplateId(new URLSearchParams(window.location.search).get('template'))
  }, [])
  const [addMenu, setAddMenu] = useState<
    { mode: 'trigger' } | { mode: 'step'; source: string; handle: EdgeHandle } | null
  >(null)
  const [testOpen, setTestOpen] = useState(false)
  const [testResult, setTestResult] = useState<FlowTestResult | null>(null)
  const [statsOn, setStatsOn] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [published, setPublished] = useState(false)
  const stats = useNodeStats(flowId, statsOn)
  const flows = useFlows()
  const tags = useTags()
  const templates = useApprovedTemplates()
  const members = useQuery({
    queryKey: automationKey(tenantId, 'members'),
    queryFn: () => get<{ data: Member[] }>('/team/members').then((r) => r.data),
    enabled: can('team.read'),
  })

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

  const inFlight = useRef<Promise<boolean> | null>(null)
  const flush = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) {
      const ok = await inFlight.current
      return ok ? flush() : false
    }
    const run = async () => {
      clearTimeout(timer.current)
      const g = pending.current
      const nextName = namePending.current
      if ((!g || !etag.current) && nextName === null) return true
      namePending.current = null
      pending.current = null
      setSave('saving')
      try {
        if (nextName !== null && !nextName.trim()) {
          namePending.current = nextName
          pending.current = g
          setSave('dirty')
          return false
        }
        if (nextName !== null) {
          await patch(`/flows/${flowId}`, { name: nextName })
          void qc.invalidateQueries({ queryKey: automationKey(tenantId, 'flow', flowId) })
        }
        if (g && etag.current) {
          const r = await put<{ data: FlowVersion }>(
            `/flows/${flowId}/draft`,
            { graph: g },
            { headers: { 'If-Match': etag.current } },
          )
          etag.current = r.data.etag
          qc.setQueryData(automationKey(tenantId, 'draft', flowId), r.data)
          void qc.invalidateQueries({ queryKey: automationKey(tenantId, 'flow', flowId) })
          setServerIssues(
            (r.data.validation?.errors ?? []).filter((e): e is FlowIssue =>
              SERVER_CODES.has(e.code),
            ),
          )
        }
        setSave(pending.current || namePending.current !== null ? 'dirty' : 'saved')
        return true
      } catch (e) {
        if (nextName !== null) namePending.current ??= nextName
        pending.current ??= g
        if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') setSave('conflict')
        else {
          pending.current ??= g
          setSave('error')
        }
        return false
      }
    }
    inFlight.current = run()
    let ok: boolean
    try {
      ok = await inFlight.current
    } finally {
      inFlight.current = null
    }
    return ok && (pending.current || namePending.current !== null) ? flush() : ok
  }, [flowId, qc, tenantId])

  useEffect(() => {
    if (draft.data && !pending.current && save === 'saved') etag.current = draft.data.etag
  }, [draft.data, save])

  async function discard() {
    if (
      !(await confirm({
        title: 'Discard draft changes?',
        description: 'Return to the published version. Running sessions are unchanged.',
        confirmLabel: 'Discard draft changes',
        destructive: true,
      }))
    )
      return
    clearTimeout(timer.current)
    if (inFlight.current) await inFlight.current
    const queued = pending.current
    try {
      pending.current = null
      const current =
        qc.getQueryData<FlowVersion>(automationKey(tenantId, 'draft', flowId)) ?? draft.data!
      const version =
        current.state === 'DRAFT'
          ? (
              await del<{ data: FlowVersion }>(`/flows/${flowId}/draft`, {
                headers: { 'If-Match': etag.current ?? current.etag },
              })
            ).data
          : current
      setGraph(version.graph)
      etag.current = version.etag
      setSave('saved')
      setServerIssues([])
      setTestResult(null)
      qc.setQueryData(automationKey(tenantId, 'draft', flowId), version)
      void qc.invalidateQueries({ queryKey: automationKey(tenantId, 'flow', flowId) })
      void qc.invalidateQueries({ queryKey: automationKey(tenantId, 'flows') })
      toast.success('Draft changes discarded.')
    } catch (e) {
      pending.current ??= queued
      toast.error(e instanceof ApiError ? e.message : 'Could not discard draft changes.')
    }
  }

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
  const unsaved = save !== 'saved'
  useEffect(() => {
    if (!unsaved) return
    const protect = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', protect)
    return () => window.removeEventListener('beforeunload', protect)
  }, [unsaved])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        (event.target as HTMLElement)?.closest(
          '[role="dialog"], [role="alertdialog"], [role="listbox"]',
        )
      )
        return
      if (event.key === 'Escape') {
        setSelected(null)
        setPreviewOpen(false)
        setRightTab('settings')
        try {
          localStorage.setItem(`${preferenceKey}.preview`, 'false')
        } catch {
          /* Optional preference. */
        }
        return
      }
      if (
        (event.target as HTMLElement)?.closest('input, textarea, select, [contenteditable="true"]')
      )
        return
      if (event.key === '?') {
        event.preventDefault()
        setHelpOpen(true)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [preferenceKey])
  async function back() {
    if (
      unsaved &&
      !(await confirm({
        title: 'Leave with unsaved changes?',
        description: 'Your latest edits have not been saved.',
        confirmLabel: 'Leave editor',
        destructive: true,
      }))
    )
      return
    router.push('/automations')
  }

  const issues = useMemo(() => {
    if (!graph) return []
    return [...validateFlowGraph(graph).errors, ...serverIssues]
  }, [graph, serverIssues])

  const summary = useMemo(() => {
    if (!graph) return ''
    return describeFlow(graph, {
      tag: (id) => tags.data?.find((t) => t.id === id)?.name,
      template: (id) => templates.data?.find((t) => t.templateId === id)?.name,
      member: (id) => members.data?.find((m) => m.userId === id)?.name,
    })
  }, [graph, tags.data, templates.data, members.data])
  const checklist = useMemo(
    () => (graph ? setupChecklist(graph, issues, templateId) : []),
    [graph, issues, templateId],
  )
  // Live flows that can match the same event (engine matching rules, no engine change).
  const overlaps = useMemo(() => {
    const trigger = graph ? triggerOf(graph) : undefined
    const self = flows.data?.find((x) => x.id === flowId)
    if (!trigger || !self) return []
    const live = (flows.data ?? []).flatMap((x) =>
      x.status === 'ACTIVE' && x.liveTrigger
        ? [
            {
              id: x.id,
              name: x.name,
              priority: x.priority,
              createdAt: x.createdAt,
              trigger: x.liveTrigger,
            },
          ]
        : [],
    )
    return findOverlaps({ ...self, trigger }, live)
  }, [graph, flows.data, flowId])
  const statsMap = useMemo(
    () => (statsOn && stats.data ? new Map(stats.data.map((s) => [s.nodeId, s])) : undefined),
    [statsOn, stats.data],
  )
  const testPath = useMemo(() => {
    if (!testResult?.matched || !graph) return undefined
    const steps = testResult.steps
    const nodes = new Map(steps.map((s) => [s.nodeId, s.status]))
    const edges = new Set<string>()
    steps.forEach((s, i) => {
      const next = steps[i + 1]
      const e = next
        ? graph.edges.find(
            (x) => x.source === s.nodeId && x.sourceHandle === s.handle && x.target === next.nodeId,
          )
        : undefined
      if (e) edges.add(e.id)
    })
    return { nodes, edges }
  }, [testResult, graph])

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
          ...overlaps.map((o) => overlapSentence(o, flowId)),
          ...(graph?.replyStudio?.kind === 'BOT_FLOW'
            ? [
                <div key="answers" className="max-h-64 overflow-y-auto">
                  <CollectedAnswersPreview graph={graph} />
                </div>,
              ]
            : []),
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
      setPublished(true)
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

  function add(type: NodeType, position?: { x: number; y: number }) {
    if (!graph || !editable || (mobile && view === 'canvas')) return
    const after =
      selected && !graph.nodes.find((n) => n.id === selected && n.type === 'action.end')
        ? selected
        : undefined
    const r = addNode(graph, type, isTrigger(type) ? undefined : after)
    if (position) r.graph.layout[r.id] = position
    change(r.graph)
    selectStep(r.id)
  }

  function pick(type: NodeType) {
    if (!graph || !addMenu) return
    const r =
      addMenu.mode === 'trigger'
        ? addTrigger(graph, type)
        : insertNode(graph, type, addMenu.source, addMenu.handle)
    change(r.graph)
    setAddMenu(null)
    selectStep(r.id)
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

  const useTag = (nodeId: string, tagId: string) =>
    change({
      ...graph,
      nodes: graph.nodes.map((n) => {
        if (n.id !== nodeId) return n
        const current = Array.isArray(n.config.tagIds) ? (n.config.tagIds as string[]) : []
        return { ...n, config: { ...n.config, tagIds: [...new Set([...current, tagId])] } }
      }),
    })
  const setup = (
    <SetupPanel items={checklist} onFocus={selectStep} onUseTag={useTag} editable={editable} />
  )
  const blocked = issues.length
    ? 'Tests run the saved draft once every step is set up and connected. Use “Ready to publish?” below to fix what’s missing.'
    : undefined

  const inspector = node ? (
    <NodeInspector
      key={node.id}
      flowId={flowId}
      node={node}
      issues={issues.filter((i) => i.nodeId === node.id)}
      readOnly={!editable || (mobile && view === 'canvas')}
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
  ) : checklist.length ? (
    setup
  ) : (
    <div className="flex flex-col gap-2">
      <h2 className="text-md font-semibold text-fg">Step settings</h2>
      <p className="text-sm text-fg-secondary">
        {hasTrigger
          ? 'Select a step on the canvas or outline to inspect its settings.'
          : 'Add a trigger to start your automation.'}
      </p>
    </div>
  )
  const rightPanel = (
    <Tabs value={rightTab} onValueChange={setRightTab} className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex shrink-0 items-center gap-1 border-b border-border-subtle">
        <TabsList aria-label="Canvas side panel" className="flex-1 border-b-0">
          <TabsTrigger value="settings">Node settings</TabsTrigger>
          {previewOpen ? <TabsTrigger value="preview">Preview</TabsTrigger> : null}
        </TabsList>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Close side panel"
          onClick={() => {
            togglePreview(false)
            setSelected(null)
          }}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <TabsContent value="settings" className="mt-0 min-h-0 flex-1 overflow-y-auto">
        {inspector}
      </TabsContent>
      {previewOpen ? (
        <TabsContent
          value="preview"
          forceMount
          hidden={rightTab !== 'preview'}
          className="mt-0 min-h-0 flex-1 overflow-hidden"
        >
          <LivePreview
            graph={graph}
            templates={templates.data ?? []}
            issues={issues}
            selected={selected}
            onSelect={selectStep}
            tagName={(id) => tags.data?.find((tag) => tag.id === id)?.name}
            memberName={(id) => members.data?.find((member) => member.userId === id)?.name}
          />
        </TabsContent>
      ) : null}
    </Tabs>
  )
  if (
    graph.replyStudio?.kind === 'AUTO_REPLY' &&
    search.get('canvas') !== '1' &&
    !search.get('node')
  )
    return (
      <AutoReplyEditor
        flow={f}
        draft={draft.data!}
        graph={graph}
        onChange={change}
        onSave={flush}
        onPublish={() => void publish()}
        onDiscard={() => void discard()}
        saveLabel={SAVE_LABEL[save]}
        readOnly={!editable}
        canPublish={can('automations.publish')}
        issues={issues}
        overlaps={overlaps}
        name={name ?? f.name}
        onName={(value) => {
          setName(value)
          namePending.current = value
          setSave('dirty')
          clearTimeout(timer.current)
          timer.current = setTimeout(() => void flush(), 800)
        }}
        onPriority={async (value) => {
          try {
            await patch(`/flows/${flowId}`, { priority: value })
            refresh()
          } catch (e) {
            toast.error(e instanceof ApiError ? e.message : 'Could not save priority.')
          }
        }}
        busy={publishing}
      />
    )
  return (
    <>
      <BuilderPage
        appearance="canvas"
        header={{ title: f.name }}
        topbar={
          <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-border-subtle bg-surface px-3 py-2 md:flex-nowrap">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Back to Automations"
              onClick={() => void back()}
            >
              <ArrowLeft aria-hidden="true" />
              <span className="hidden xl:inline">Automations</span>
            </Button>
            <h1 className="sr-only">{f.name}</h1>
            <Input
              aria-label="Flow name"
              className="w-32 min-w-0 md:w-44"
              value={name ?? f.name}
              readOnly={!editable || (mobile && view === 'canvas')}
              aria-invalid={name !== null && !name.trim() ? true : undefined}
              maxLength={120}
              onChange={(event) => {
                setName(event.target.value)
                namePending.current = event.target.value
                setSave('dirty')
                clearTimeout(timer.current)
                if (event.target.value.trim()) timer.current = setTimeout(() => void flush(), 800)
              }}
            />
            <StatusBadge status={f.status} label={f.status === 'ACTIVE' ? 'Live' : undefined} />
            <Button
              variant="ghost"
              size="sm"
              aria-live="polite"
              onClick={() => void flush()}
              disabled={save === 'saved' || save === 'saving'}
            >
              {SAVE_LABEL[save]}
            </Button>
            <Tooltip content={summary}>
              <p
                tabIndex={0}
                data-testid="flow-summary"
                className="hidden min-w-0 flex-1 truncate text-sm text-fg-secondary lg:block"
              >
                {summary}
              </p>
            </Tooltip>
            <div className="ml-auto flex flex-wrap items-center gap-1">
              <Button
                variant="secondary"
                size="sm"
                aria-pressed={previewOpen}
                onClick={() => togglePreview(!previewOpen)}
              >
                <Smartphone aria-hidden="true" />
                Preview
              </Button>
              <Button
                variant="secondary"
                size="sm"
                aria-pressed={view === 'outline'}
                onClick={() => setView(view === 'outline' ? 'canvas' : 'outline')}
              >
                Outline
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Keyboard shortcuts"
                onClick={() => setHelpOpen(true)}
              >
                <CircleHelp aria-hidden="true" />
              </Button>
              {editable ? (
                <Button variant="secondary" size="sm" onClick={() => setSettingsOpen(true)}>
                  <Settings2 aria-hidden="true" />
                  Settings
                </Button>
              ) : null}
              <FlowActivity flowId={flowId} />
              <Button variant="secondary" size="sm" asChild>
                <Link href={`/automations/${flowId}/history`}>
                  <History aria-hidden="true" />
                  History
                </Link>
              </Button>
              {editable ? (
                <Button variant="secondary" size="sm" onClick={() => setTestOpen(true)}>
                  <FlaskConical aria-hidden="true" />
                  Test flow
                </Button>
              ) : null}
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
                  size="sm"
                  onClick={() => void publish()}
                  loading={publishing}
                  disabled={issues.length > 0}
                >
                  <Rocket aria-hidden="true" />
                  {f.activeVersion ? 'Publish changes' : 'Publish'}
                </Button>
              ) : null}
            </div>
          </header>
        }
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
          ) : flow.data?.managedBy === 'REPLY_STUDIO' ? (
            <VersionState
              flow={f}
              draft={draft.data!}
              dirty={save !== 'saved'}
              onDiscard={() => void discard()}
              disabled={!editable}
            />
          ) : flow.data?.managedBy === 'AI_ASSISTANT' ? (
            <Alert
              tone="info"
              title="Managed by AI Assistant"
              action={
                <Button asChild variant="secondary" size="sm">
                  <Link href="/ai-assistant">Open AI Assistant</Link>
                </Button>
              }
            >
              Turn it on or pause it from the AI Assistant page. Changes you publish here are used
              by the assistant.
            </Alert>
          ) : (
            <VersionState
              flow={f}
              draft={draft.data!}
              dirty={save !== 'saved'}
              onDiscard={() => void discard()}
              disabled={!editable}
            />
          )
        }
        palette={
          editable && !libraryCollapsed ? (
            <NodeLibrary
              replyStudio={flow.data?.managedBy === 'REPLY_STUDIO'}
              hasTrigger={hasTrigger}
              onAdd={add}
            />
          ) : undefined
        }
        inspector={wide && (node || previewOpen) ? rightPanel : undefined}
      >
        <Tabs value={view} onValueChange={setView} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle bg-surface px-3 py-2">
            <TabsList aria-label="Builder view" className="w-auto border-b-0">
              <TabsTrigger value="canvas">Canvas</TabsTrigger>
              <TabsTrigger value="outline">Outline</TabsTrigger>
            </TabsList>
            <div className="flex flex-wrap gap-2">
              {editable ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="hidden md:inline-flex"
                  aria-expanded={!libraryCollapsed}
                  onClick={() => {
                    setLibraryCollapsed(!libraryCollapsed)
                    try {
                      localStorage.setItem(`${preferenceKey}.library`, String(!libraryCollapsed))
                    } catch {
                      /* Optional preference. */
                    }
                  }}
                >
                  <PanelLeft aria-hidden="true" />
                  {libraryCollapsed ? 'Show steps' : 'Hide steps'}
                </Button>
              ) : null}
              {testPath ? (
                <Button variant="ghost" size="sm" onClick={() => setTestResult(null)}>
                  <X aria-hidden="true" />
                  Clear test path
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                aria-pressed={statsOn}
                onClick={() => setStatsOn((v) => !v)}
              >
                <BarChart3 aria-hidden="true" />
                Step counts
              </Button>
              {editable ? (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="md:hidden"
                    disabled={mobile && view === 'canvas'}
                    onClick={() => setLibraryOpen(true)}
                  >
                    <PanelLeft aria-hidden="true" />
                    Add step
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={mobile && view === 'canvas'}
                    onClick={() => change(autoLayout(graph))}
                  >
                    <LayoutGrid aria-hidden="true" />
                    Tidy up
                  </Button>
                </>
              ) : null}
            </div>
          </div>
          <TabsContent value="canvas" className="relative mt-0 min-h-0 flex-1">
            {mobile ? (
              <p className="absolute top-2 left-2 z-10 rounded-md border border-border-subtle bg-surface px-3 py-2 text-sm text-fg-secondary">
                Editing is best on a larger screen
              </p>
            ) : null}
            <div className="h-full">
              <FlowCanvas
                graph={graph}
                viewportKey={`${preferenceKey}.${flowId}.viewport`}
                onAddNode={add}
                issues={issues}
                selectedId={selected}
                onSelect={selectStep}
                onChange={editable ? change : undefined}
                onAddAfter={(source, handle) => setAddMenu({ mode: 'step', source, handle })}
                onAddTrigger={() => setAddMenu({ mode: 'trigger' })}
                traversed={testPath?.nodes}
                traversedEdges={testPath?.edges}
                stats={statsMap}
                readOnly={!editable || mobile}
              />
            </div>
          </TabsContent>
          <TabsContent value="outline" className="min-h-0 flex-1 overflow-y-auto p-3">
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
        <section
          aria-label="Publish preparation"
          className="shrink-0 border-t border-border-subtle bg-surface"
        >
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(!drawerOpen)}
          >
            {drawerOpen ? <ChevronDown aria-hidden="true" /> : <ChevronUp aria-hidden="true" />}
            Setup checklist · Ready to publish
          </Button>
          {drawerOpen ? (
            <Tabs defaultValue="setup" className="max-h-64 overflow-y-auto p-3">
              <TabsList aria-label="Publish preparation tabs">
                <TabsTrigger value="setup">Setup checklist</TabsTrigger>
                <TabsTrigger value="ready">Ready to publish</TabsTrigger>
              </TabsList>
              <TabsContent value="setup">{setup}</TabsContent>
              <TabsContent value="ready">
                <ReadinessPanel
                  graph={graph}
                  issues={issues}
                  overlaps={overlaps}
                  flowId={flowId}
                  onFix={selectStep}
                />
              </TabsContent>
            </Tabs>
          ) : null}
        </section>
      </BuilderPage>
      <Drawer
        open={!wide && (!!node || previewOpen)}
        onOpenChange={(open) => {
          if (!open) {
            togglePreview(false)
            setSelected(null)
          }
        }}
      >
        <DrawerContent
          title="Step settings and preview"
          description="Inspect a step or explore the visual conversation."
          width="md"
          className="[&>div:last-child]:flex [&>div:last-child]:min-h-0 [&>div:last-child]:flex-col [&>div:last-child]:overflow-hidden"
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
          {rightPanel}
        </DrawerContent>
      </Drawer>
      <Modal open={helpOpen} onOpenChange={setHelpOpen}>
        <ModalContent
          title="Keyboard shortcuts"
          description="Use the outline for keyboard and screen-reader editing."
        >
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <dt>Delete / Backspace</dt>
            <dd>Remove selected node or edge</dd>
            <dt>Escape</dt>
            <dd>Close settings and deselect</dd>
            <dt>?</dt>
            <dd>Open this help</dd>
            <dt>Arrow keys</dt>
            <dd>Move focused canvas node</dd>
          </dl>
        </ModalContent>
      </Modal>
      <Modal open={libraryOpen} onOpenChange={setLibraryOpen}>
        <ModalContent title="Add a step" description="Choose a supported step for this flow.">
          <NodeLibrary
            replyStudio={flow.data?.managedBy === 'REPLY_STUDIO'}
            hasTrigger={hasTrigger}
            onAdd={(type) => {
              add(type)
              setLibraryOpen(false)
            }}
          />
        </ModalContent>
      </Modal>
      <AddStepMenu
        replyStudio={flow.data?.managedBy === 'REPLY_STUDIO'}
        open={!!addMenu}
        onOpenChange={(open) => !open && setAddMenu(null)}
        mode={addMenu?.mode ?? 'step'}
        onPick={pick}
      />
      {editable && graph.replyStudio ? (
        <Drawer open={testOpen} onOpenChange={setTestOpen}>
          <DrawerContent title="Test flow">
            <ReplyTestPhone
              graph={graph}
              save={async () => {
                if (!(await flush())) throw new Error('Save your changes before testing.')
                return flowId
              }}
              onResult={(r) => {
                setTestResult(r)
                if (r?.steps.at(-1)) setSelected(r.steps.at(-1)!.nodeId)
              }}
              onSelect={(id) => {
                selectStep(id)
                setTestOpen(false)
              }}
            />
          </DrawerContent>
        </Drawer>
      ) : editable ? (
        <TestDrawer
          flowId={flowId}
          open={testOpen}
          onOpenChange={setTestOpen}
          trigger={graph.nodes.find((n) => isTrigger(n.type))}
          beforeRun={flush}
          result={testResult}
          onResult={(r) => {
            setTestResult(r)
            if (r?.steps.at(-1)) setSelected(r.steps.at(-1)!.nodeId)
          }}
          onSelect={(id) => {
            selectStep(id)
            setTestOpen(false)
          }}
          blocked={blocked}
        />
      ) : null}
      {settingsOpen ? (
        <FlowSettings
          flow={f}
          replyStudio={graph.replyStudio}
          onReplyStudioSave={async (settings) => {
            change({ ...graph, replyStudio: settings })
            if (!(await flush())) throw new Error('Session settings could not be saved. Try again.')
          }}
          open
          onOpenChange={setSettingsOpen}
          onSaved={() => {
            setName(null)
            refresh()
          }}
        />
      ) : null}
      <PublishedDialog
        open={published}
        onOpenChange={setPublished}
        summary={summary}
        onTest={() => {
          setPublished(false)
          setTestOpen(true)
        }}
      />
    </>
  )
}

'use client'

import {
  type DraftGraph,
  type EdgeHandle,
  type FlowIssue,
  type FlowNodeStats,
  outputsOf,
  NODE_TYPES,
  type NodeType,
  STEP_STATUSES,
} from '@fenwira/contracts'
import { Button, cn, StatusBadge } from '@fenwira/ui'
import {
  Background,
  BaseEdge,
  type Connection,
  Controls,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  getSmoothStepPath,
  Handle,
  MiniMap,
  MarkerType,
  type Node,
  type NodeChange,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  applyNodeChanges,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { AlertTriangle, CheckCircle2, Plus } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NodeSymbol } from './node-presentation'
import {
  autoLayout,
  connect,
  type DraftNode,
  HANDLE_LABEL,
  issuesFor,
  KIND_LABEL,
  kindOf,
  NODE_LABEL,
  type NodeKind,
  removeNode,
  summarize,
} from '@/lib/automation'

type Stats = FlowNodeStats[number]
type CardData = {
  node: DraftNode
  issues: FlowIssue[]
  traversed?: boolean
  stepStatus?: string
  stats?: Stats
  /** Editable canvases: "+" under every open branch. */
  onAddAfter?: (source: string, handle: EdgeHandle) => void
  connected: EdgeHandle[]
}

/** Header band per node kind (design system → Flow nodes). */
const HEADER: Record<NodeKind, string> = {
  trigger: 'bg-slate text-surface',
  message: 'border-b border-border bg-surface text-primary-strong',
  condition: 'bg-warning-soft text-warning-strong',
  action: 'bg-info-soft text-info-strong',
  ai: 'bg-info-soft text-info-strong',
}
const HANDLE_TONE: Partial<Record<EdgeHandle, string>> = {
  yes: 'bg-success-soft text-success-strong',
  no: 'bg-neutral-soft text-secondary',
  error: 'bg-danger-soft text-danger-strong',
  replied: 'bg-success-soft text-success-strong',
  needs_human: 'bg-info-soft text-info-strong',
}
/** Handles sit at the centre of equal columns, so labels and "+" buttons line up with them. */
const handleLeft = (i: number, n: number) => `${((i + 0.5) / n) * 100}%`

const FlowCard = memo(function FlowCard({ data, selected }: NodeProps<Node<CardData>>) {
  const { node, issues, traversed, stepStatus, stats, onAddAfter, connected } = data
  const kind = kindOf(node.type)
  const outputs = outputsOf(node.type)
  const replayStatus = STEP_STATUSES.find((status) => status === stepStatus)
  const labelled = outputs.length > 1 || outputs.some((h) => h !== 'next')
  return (
    <div
      data-testid={`flow-node-${node.id}`}
      data-kind={kind}
      className={cn(
        'relative w-64 rounded-lg border bg-surface text-slate shadow-raised',
        issues.length ? 'border-warning' : 'border-border',
        traversed && 'border-primary ring-2 ring-primary',
        selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
      )}
    >
      {kind !== 'trigger' ? (
        <Handle type="target" position={Position.Top} className="bg-slate-400!" />
      ) : null}
      <div
        className={cn(
          'flex items-center gap-1.5 rounded-t-lg px-3 py-1.5 text-xs font-semibold',
          HEADER[kind],
        )}
      >
        <NodeSymbol type={node.type} bare />
        <span>{KIND_LABEL[kind]}</span>
        <span className="ml-auto">
          {replayStatus ? (
            <StatusBadge status={replayStatus} />
          ) : issues.length ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-surface px-1.5 py-0.5 text-warning-strong">
              <AlertTriangle className="size-3.5" aria-hidden="true" />
              <span>Needs attention</span>
            </span>
          ) : (
            <span className="inline-flex rounded-full bg-surface p-0.5 text-success-strong">
              <CheckCircle2 className="size-3.5" aria-hidden="true" />
              <span className="sr-only">Ready</span>
            </span>
          )}
        </span>
      </div>
      <div className="px-3 py-2.5">
        <p className="text-sm font-semibold">{NODE_LABEL[node.type]}</p>
        <p className="mt-0.5 line-clamp-2 text-xs text-secondary">{summarize(node)}</p>
        {stats ? (
          <p
            className="mt-2 flex flex-wrap gap-x-3 text-xs text-secondary"
            data-testid={`node-stats-${node.id}`}
          >
            <span>{stats.entered.toLocaleString('en-IN')} entered</span>
            <span>{stats.completed.toLocaleString('en-IN')} completed</span>
            <span className={stats.failed ? 'font-medium text-danger-strong' : undefined}>
              {stats.failed.toLocaleString('en-IN')} failed
            </span>
          </p>
        ) : null}
      </div>
      {labelled ? (
        <div
          className="grid gap-1 px-1 pb-2 text-center"
          style={{ gridTemplateColumns: `repeat(${outputs.length}, minmax(0, 1fr))` }}
        >
          {outputs.map((h) => (
            <span
              key={h}
              className={cn(
                'mx-auto rounded-full px-1.5 py-0.5 text-xs font-medium',
                HANDLE_TONE[h] ?? 'bg-neutral-soft text-secondary',
              )}
            >
              {HANDLE_LABEL[h]}
            </span>
          ))}
        </div>
      ) : null}
      {outputs.map((h, i) => (
        <Handle
          key={h}
          id={h}
          type="source"
          position={Position.Bottom}
          style={{ left: handleLeft(i, outputs.length) }}
          className={h === 'error' ? 'bg-danger!' : 'bg-slate-400!'}
        />
      ))}
      {onAddAfter
        ? outputs.map((h, i) =>
            h === 'error' || connected.includes(h) ? null : (
              <button
                key={`add-${h}`}
                type="button"
                className="nodrag nopan absolute top-full mt-4 flex size-7 -translate-x-1/2 items-center justify-center rounded-full border border-border-strong bg-surface text-secondary shadow-raised hover:border-primary hover:text-primary-strong focus-visible:outline-2 focus-visible:outline-primary-strong"
                style={{ left: handleLeft(i, outputs.length) }}
                aria-label={`Add a step after ${NODE_LABEL[node.type]}${labelled ? ` (${HANDLE_LABEL[h]})` : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onAddAfter(node.id, h)
                }}
              >
                <Plus className="size-4" aria-hidden="true" />
              </button>
            ),
          )
        : null}
    </div>
  )
})

type EdgeData = {
  label?: string
  hot?: boolean
  /** Accessible name of the "+" button; absent on read-only canvases. */
  insertLabel?: string
  onInsert?: () => void
}

/** Smooth-step edge with its branch label and a "+" to insert a step on it. */
function PlusEdge(props: EdgeProps<Edge<EdgeData>>) {
  const [path, x, y] = getSmoothStepPath(props)
  const d = props.data ?? {}
  return (
    <>
      <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} />
      {d.label || d.onInsert ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute flex items-center gap-1"
            style={{
              transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
              pointerEvents: 'all',
            }}
          >
            {d.label ? (
              <span className="rounded-full border border-border bg-surface px-1.5 py-0.5 text-xs text-slate">
                {d.label}
              </span>
            ) : null}
            {d.onInsert ? (
              <button
                type="button"
                className="flex size-6 items-center justify-center rounded-full border border-border-strong bg-surface text-secondary shadow-raised hover:border-primary hover:text-primary-strong focus-visible:outline-2 focus-visible:outline-primary-strong"
                aria-label={d.insertLabel}
                onClick={(e) => {
                  e.stopPropagation()
                  d.onInsert?.()
                }}
              >
                <Plus className="size-3.5" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  )
}

const nodeTypes = { card: FlowCard }
const edgeTypes = { plus: PlusEdge }

export type FlowCanvasProps = {
  graph: DraftGraph
  issues: FlowIssue[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onChange?: (graph: DraftGraph) => void
  /** Replay/test overlay: traversed node ids and their step status. */
  traversed?: Map<string, string>
  /** Edge ids actually taken (a test run knows the handle); otherwise both ends traversed. */
  traversedEdges?: Set<string>
  /** "+" on edges and open branches; the builder opens the add-step menu. */
  onAddAfter?: (source: string, handle: EdgeHandle) => void
  onAddTrigger?: () => void
  stats?: Map<string, Stats>
  readOnly?: boolean
  viewportKey?: string
  onAddNode?: (type: NodeType, position: { x: number; y: number }) => void
}

function useWide() {
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1280px)')
    const update = () => setWide(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return wide
}

function Canvas({
  graph,
  issues,
  selectedId,
  onSelect,
  onChange,
  traversed,
  traversedEdges,
  onAddAfter,
  onAddTrigger,
  stats,
  readOnly,
  viewportKey,
  onAddNode,
}: FlowCanvasProps) {
  const wide = useWide()
  const [selectedEdges, setSelectedEdges] = useState<Set<string>>(new Set())
  // Browser measurements stay local; they are not part of the persisted flow graph.
  const [measurements, setMeasurements] = useState<
    Record<string, { width: number; height: number }>
  >({})
  // `layout` is optional editor metadata (graph contract), so a flow saved without positions would
  // stack every node at the origin. Unplaced nodes get a display-only automatic position; nothing is
  // persisted until the user moves or tidies them.
  const fallback = useMemo(
    () => (graph.nodes.some((n) => !graph.layout[n.id]) ? autoLayout(graph).layout : {}),
    [graph],
  )
  const adding = readOnly ? undefined : onAddAfter
  const nodes: Array<Node<CardData>> = useMemo(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        type: 'card',
        measured: measurements[n.id],
        position: graph.layout[n.id] ?? fallback[n.id] ?? { x: 0, y: 0 },
        selected: n.id === selectedId,
        data: {
          node: n,
          issues: issuesFor(issues, n.id),
          traversed: traversed?.has(n.id),
          stepStatus: traversed?.get(n.id),
          stats: stats?.get(n.id),
          onAddAfter: adding,
          connected: graph.edges.filter((e) => e.source === n.id).map((e) => e.sourceHandle),
        },
        deletable: !readOnly,
      })),
    [graph, fallback, issues, selectedId, traversed, readOnly, measurements, stats, adding],
  )
  // Initial fit keeps step text readable (zoom ≥ 0.75). A flow taller than the canvas then opens at
  // its start (the trigger) instead of being centred with both ends cut off.
  const flow = useReactFlow()
  const initialized = useNodesInitialized()
  const fitted = useRef(false)
  useEffect(() => {
    if (!initialized || fitted.current || !nodes.length) return
    fitted.current = true
    try {
      const saved = viewportKey && localStorage.getItem(viewportKey)
      if (saved) {
        const viewport = JSON.parse(saved) as { x: number; y: number; zoom: number }
        if ([viewport.x, viewport.y, viewport.zoom].every(Number.isFinite) && viewport.zoom > 0) {
          void flow.setViewport(viewport)
          return
        }
      }
    } catch {
      /* A missing preference falls back to fitting the graph. */
    }
    // Open with the whole flow in view; large multi-branch flows zoom out to at most 50%.
    void flow.fitView({ padding: 0.12, minZoom: 0.5, maxZoom: 1 }).then(() => {
      const viewport = flow.getViewport()
      const top = Math.min(...nodes.map((n) => n.position.y))
      if (viewport.y + top * viewport.zoom < 0)
        void flow.setViewport({ ...viewport, y: 24 - top * viewport.zoom })
    })
  }, [initialized, flow, nodes, viewportKey])
  const edges: Array<Edge<EdgeData>> = useMemo(() => {
    const label = (id: string) => {
      const n = graph.nodes.find((x) => x.id === id)
      return n ? NODE_LABEL[n.type] : 'step'
    }
    return graph.edges.map((e) => {
      const hot = traversedEdges
        ? traversedEdges.has(e.id)
        : traversed?.has(e.source) && traversed?.has(e.target)
      return {
        id: e.id,
        selected: selectedEdges.has(e.id),
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        type: 'plus',
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: hot ? 'var(--color-primary)' : 'var(--color-slate-400)',
        },
        className: hot ? 'fw-edge-active' : undefined,
        data: {
          label: e.sourceHandle === 'next' ? undefined : HANDLE_LABEL[e.sourceHandle],
          hot: !!hot,
          ...(adding
            ? {
                insertLabel: `Add a step between ${label(e.source)} and ${label(e.target)}`,
                onInsert: () => adding(e.source, e.sourceHandle),
              }
            : {}),
        },
      }
    })
  }, [graph.edges, graph.nodes, traversed, traversedEdges, adding, selectedEdges])

  const onNodesChange = useCallback(
    (changes: Array<NodeChange<Node<CardData>>>) => {
      const resized = changes.filter((c) => c.type === 'dimensions' && c.dimensions)
      if (resized.length)
        setMeasurements((previous) => {
          let next = previous
          for (const c of resized) {
            if (c.type !== 'dimensions' || !c.dimensions) continue
            const old = previous[c.id]
            if (old?.width !== c.dimensions.width || old?.height !== c.dimensions.height)
              next = { ...next, [c.id]: c.dimensions }
          }
          return next
        })
      if (readOnly || !onChange) return
      let next = graph
      for (const c of changes) {
        if (c.type === 'remove') next = removeNode(next, c.id)
      }
      const moved = applyNodeChanges(
        changes.filter((c) => c.type === 'position'),
        nodes,
      )
      const layout = { ...next.layout }
      let changed = next !== graph
      for (const c of changes)
        if (c.type === 'position' && c.position) {
          const n = moved.find((m) => m.id === c.id)
          if (n) {
            layout[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) }
            changed = true
          }
        }
      if (changed) onChange({ ...next, layout })
    },
    [graph, nodes, onChange, readOnly],
  )

  const onConnect = useCallback(
    (c: Connection) => {
      if (readOnly || !onChange || !c.source || !c.target) return
      onChange(connect(graph, c.source, (c.sourceHandle ?? 'next') as EdgeHandle, c.target))
    },
    [graph, onChange, readOnly],
  )

  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={(changes) => {
          setSelectedEdges((previous) => {
            const next = new Set(previous)
            for (const change of changes)
              if (change.type === 'select') {
                if (change.selected) next.add(change.id)
                else next.delete(change.id)
              }
            return next
          })
          if (readOnly || !onChange) return
          const removed = new Set(changes.filter((c) => c.type === 'remove').map((c) => c.id))
          if (removed.size)
            onChange({ ...graph, edges: graph.edges.filter((e) => !removed.has(e.id)) })
        }}
        onConnect={onConnect}
        onMoveEnd={(_, viewport) => {
          try {
            if (viewportKey) localStorage.setItem(viewportKey, JSON.stringify(viewport))
          } catch {
            /* Optional preference. */
          }
        }}
        onDragOver={(event) => {
          if (!readOnly) {
            event.preventDefault()
            event.dataTransfer.dropEffect = 'copy'
          }
        }}
        onDrop={(event) => {
          event.preventDefault()
          if (readOnly) return
          const type = event.dataTransfer.getData('application/fenwira-node')
          const known = NODE_TYPES.find((candidate) => candidate === type)
          if (known)
            onAddNode?.(known, flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }))
        }}
        onNodeClick={(_, n) => onSelect(n.id)}
        onPaneClick={() => {
          onSelect(null)
          setSelectedEdges(new Set())
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            onSelect(null)
            setSelectedEdges(new Set())
          }
        }}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        elementsSelectable
        deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
        proOptions={{ hideAttribution: true }}
        aria-label="Flow canvas"
      >
        <Background gap={20} />
        <Controls showInteractive={false} />
        {wide ? (
          <MiniMap
            pannable
            zoomable
            ariaLabel="Flow overview"
            style={{ width: 120, height: 80 }}
            nodeColor="var(--color-border-strong)"
            nodeStrokeColor="var(--color-secondary)"
          />
        ) : null}
      </ReactFlow>
      {!graph.nodes.length && onAddTrigger && !readOnly ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="max-w-xs text-sm text-secondary">
            Every automation starts with a trigger: the message, contact or event that sets it off.
          </p>
          <Button className="pointer-events-auto" onClick={onAddTrigger}>
            <Plus aria-hidden="true" />
            Add a trigger
          </Button>
        </div>
      ) : null}
    </>
  )
}

/** The React Flow canvas. React Flow state is converted to and from FlowGraph at this boundary. */
export function FlowCanvas(props: FlowCanvasProps) {
  return (
    <div className="fw-flow relative h-full min-h-0 w-full bg-background">
      <ReactFlowProvider>
        <Canvas {...props} />
      </ReactFlowProvider>
    </div>
  )
}

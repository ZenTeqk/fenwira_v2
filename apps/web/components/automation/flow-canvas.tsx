'use client'

import {
  type DraftGraph,
  type EdgeHandle,
  type FlowIssue,
  outputsOf,
  STEP_STATUSES,
} from '@fenwira/contracts'
import { cn, StatusBadge } from '@fenwira/ui'
import {
  Background,
  type Connection,
  Controls,
  type Edge,
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
import { AlertCircle } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NodeSymbol } from './node-presentation'
import {
  autoLayout,
  categoryOf,
  connect,
  type DraftNode,
  HANDLE_LABEL,
  issuesFor,
  NODE_LABEL,
  removeNode,
  summarize,
} from '@/lib/automation'

type CardData = {
  node: DraftNode
  issues: FlowIssue[]
  traversed?: boolean
  stepStatus?: string
}

const FlowCard = memo(function FlowCard({ data, selected }: NodeProps<Node<CardData>>) {
  const { node, issues, traversed, stepStatus } = data
  const category = categoryOf(node.type)
  const outputs = outputsOf(node.type)
  const replayStatus = STEP_STATUSES.find((status) => status === stepStatus)
  return (
    <div
      data-testid={`flow-node-${node.id}`}
      className={cn(
        'w-60 rounded-lg border border-border bg-surface px-3 py-3 text-slate shadow-raised',
        selected && 'border-primary-strong ring-1 ring-primary-strong',
        traversed && 'ring-2 ring-primary-strong',
        issues.length > 0 && 'border-danger',
      )}
    >
      {category !== 'trigger' ? (
        <Handle type="target" position={Position.Top} className="bg-slate-400!" />
      ) : null}
      <div className="flex items-center gap-3">
        <NodeSymbol type={node.type} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{NODE_LABEL[node.type]}</p>
          <p className="mt-1 line-clamp-2 text-xs text-secondary">{summarize(node)}</p>
        </div>
        {issues.length ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-danger-strong">
            <AlertCircle className="size-3.5" aria-hidden="true" />
            {issues.length}
          </span>
        ) : replayStatus ? (
          <StatusBadge status={replayStatus} />
        ) : null}
      </div>

      <div className="mt-1 flex justify-around text-xs">
        {outputs.length > 1 ? outputs.map((h) => <span key={h}>{HANDLE_LABEL[h]}</span>) : null}
      </div>
      {outputs.map((h, i) => (
        <Handle
          key={h}
          id={h}
          type="source"
          position={Position.Bottom}
          style={{ left: `${((i + 1) / (outputs.length + 1)) * 100}%` }}
          className={h === 'error' ? 'bg-danger!' : 'bg-slate-400!'}
        />
      ))}
    </div>
  )
})

const nodeTypes = { card: FlowCard }

export type FlowCanvasProps = {
  graph: DraftGraph
  issues: FlowIssue[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onChange?: (graph: DraftGraph) => void
  /** Replay overlay: traversed node ids and their step status. */
  traversed?: Map<string, string>
  readOnly?: boolean
}

function Canvas({
  graph,
  issues,
  selectedId,
  onSelect,
  onChange,
  traversed,
  readOnly,
}: FlowCanvasProps) {
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
        },
        deletable: !readOnly,
      })),
    [graph, fallback, issues, selectedId, traversed, readOnly, measurements],
  )
  // Initial fit keeps step text readable (zoom ≥ 0.75). A flow taller than the canvas then opens at
  // its start (the trigger) instead of being centred with both ends cut off.
  const flow = useReactFlow()
  const initialized = useNodesInitialized()
  const fitted = useRef(false)
  useEffect(() => {
    if (!initialized || fitted.current || !nodes.length) return
    fitted.current = true
    void flow.fitView({ padding: 0.12, minZoom: 0.75, maxZoom: 1 }).then(() => {
      const viewport = flow.getViewport()
      const top = Math.min(...nodes.map((n) => n.position.y))
      if (viewport.y + top * viewport.zoom < 0)
        void flow.setViewport({ ...viewport, y: 24 - top * viewport.zoom })
    })
  }, [initialized, flow, nodes])
  const edges: Edge[] = useMemo(
    () =>
      graph.edges.map((e) => {
        const hot = traversed?.has(e.source) && traversed?.has(e.target)
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle,
          type: 'smoothstep',
          markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--color-slate-400)' },
          label: e.sourceHandle === 'next' ? undefined : HANDLE_LABEL[e.sourceHandle],
          className: hot ? 'fw-edge-active' : undefined,
          animated: !!hot,
        }
      }),
    [graph.edges, traversed],
  )

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
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={(changes) => {
        if (readOnly || !onChange) return
        const removed = new Set(changes.filter((c) => c.type === 'remove').map((c) => c.id))
        if (removed.size)
          onChange({ ...graph, edges: graph.edges.filter((e) => !removed.has(e.id)) })
      }}
      onConnect={onConnect}
      onNodeClick={(_, n) => onSelect(n.id)}
      onPaneClick={() => onSelect(null)}
      nodesDraggable={!readOnly}
      nodesConnectable={!readOnly}
      elementsSelectable
      deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
      proOptions={{ hideAttribution: true }}
      aria-label="Flow canvas"
    >
      <Background gap={20} />
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        ariaLabel="Flow overview"
        style={{ width: 120, height: 80 }}
        nodeColor="var(--color-border-strong)"
        nodeStrokeColor="var(--color-secondary)"
      />
    </ReactFlow>
  )
}

/** The React Flow canvas. React Flow state is converted to and from FlowGraph at this boundary. */
export function FlowCanvas(props: FlowCanvasProps) {
  return (
    <div className="fw-flow h-full min-h-96 w-full bg-background">
      <ReactFlowProvider>
        <Canvas {...props} />
      </ReactFlowProvider>
    </div>
  )
}

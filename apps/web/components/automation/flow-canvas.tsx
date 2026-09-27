'use client'

import { type DraftGraph, type EdgeHandle, type FlowIssue, outputsOf } from '@fenwira/contracts'
import { cn } from '@fenwira/ui'
import {
  Background,
  type Connection,
  Controls,
  type Edge,
  Handle,
  MiniMap,
  type Node,
  type NodeChange,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { AlertCircle } from 'lucide-react'
import { memo, useCallback, useMemo } from 'react'
import {
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

/** Category colors from docs/AUTOMATION_ENGINE.md → Builder colors. */
const CATEGORY_STYLE = {
  trigger: 'border-slate bg-slate text-surface',
  message: 'border-border bg-surface text-slate',
  condition: 'border-warning bg-warning-soft text-slate',
  action: 'border-info bg-info-soft text-slate',
} as const

const FlowCard = memo(function FlowCard({ data, selected }: NodeProps<Node<CardData>>) {
  const { node, issues, traversed, stepStatus } = data
  const category = categoryOf(node.type)
  const outputs = outputsOf(node.type)
  return (
    <div
      data-testid={`flow-node-${node.id}`}
      className={cn(
        'w-60 rounded-md border-2 px-3 py-2 shadow-raised',
        CATEGORY_STYLE[category],
        selected && 'ring-2 ring-primary ring-offset-2',
        traversed && 'ring-2 ring-primary',
        issues.length > 0 && 'border-danger',
      )}
    >
      {category !== 'trigger' ? (
        <Handle type="target" position={Position.Top} className="bg-slate-400!" />
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold tracking-wide uppercase">{category}</p>
        {issues.length ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-danger-strong">
            <AlertCircle className="size-3.5" aria-hidden="true" />
            {issues.length}
          </span>
        ) : stepStatus ? (
          <span className="text-xs font-medium">{stepStatus}</span>
        ) : null}
      </div>
      <p className="font-semibold">{NODE_LABEL[node.type]}</p>
      <p className="truncate text-sm">{summarize(node)}</p>
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
  const nodes: Array<Node<CardData>> = useMemo(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        type: 'card',
        position: graph.layout[n.id] ?? { x: 0, y: 0 },
        selected: n.id === selectedId,
        data: {
          node: n,
          issues: issuesFor(issues, n.id),
          traversed: traversed?.has(n.id),
          stepStatus: traversed?.get(n.id),
        },
        deletable: !readOnly,
      })),
    [graph, issues, selectedId, traversed, readOnly],
  )
  const edges: Edge[] = useMemo(
    () =>
      graph.edges.map((e) => {
        const hot = traversed?.has(e.source) && traversed?.has(e.target)
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle,
          label: e.sourceHandle === 'next' ? undefined : HANDLE_LABEL[e.sourceHandle],
          className: hot ? 'fw-edge-active' : undefined,
          animated: !!hot,
        }
      }),
    [graph.edges, traversed],
  )

  const onNodesChange = useCallback(
    (changes: Array<NodeChange<Node<CardData>>>) => {
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
      fitView
      fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
      proOptions={{ hideAttribution: true }}
      aria-label="Flow canvas"
    >
      <Background gap={20} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable ariaLabel="Flow overview" />
    </ReactFlow>
  )
}

/** The React Flow canvas. React Flow state is converted to and from FlowGraph at this boundary. */
export function FlowCanvas(props: FlowCanvasProps) {
  return (
    <div className="fw-flow h-full min-h-96 w-full rounded-md border border-border bg-background">
      <ReactFlowProvider>
        <Canvas {...props} />
      </ReactFlowProvider>
    </div>
  )
}

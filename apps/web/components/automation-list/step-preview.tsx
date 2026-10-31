import { isTrigger, type DraftGraph } from '@fenwira/contracts'
import { ArrowRight } from 'lucide-react'
import { Fragment } from 'react'
import { NODE_LABEL } from '@/lib/automation'
import { NodeSymbol } from '@/components/automation/node-presentation'
export function StepPreview({ graph }: { graph: DraftGraph }) {
  const nodes: DraftGraph['nodes'] = []
  let node = graph.nodes.find((n) => isTrigger(n.type))
  while (node && nodes.length < 3 && !nodes.some((n) => n.id === node!.id)) {
    nodes.push(node)
    const edge = graph.edges.find((e) => e.source === node!.id && e.sourceHandle === 'next')
    node = edge ? graph.nodes.find((n) => n.id === edge.target) : undefined
  }
  return nodes.length ? (
    <div
      aria-label={`Steps: ${nodes.map((n) => NODE_LABEL[n.type]).join(', then ')}`}
      className="flex min-w-0 items-stretch gap-2"
    >
      {nodes.map((n, i) => (
        <Fragment key={n.id}>
          {i ? (
            <ArrowRight aria-hidden="true" className="my-auto size-3 shrink-0 text-fg-muted" />
          ) : null}
          <div className="flex min-w-0 flex-1 flex-col items-start gap-2 rounded-md sm:flex-row sm:items-center border border-border-subtle bg-canvas px-2 py-3">
            <NodeSymbol type={n.type} bare />
            <span className="line-clamp-2 break-words text-xs text-fg-secondary">
              {NODE_LABEL[n.type]}
            </span>
          </div>
        </Fragment>
      ))}
    </div>
  ) : (
    <p className="rounded-md border border-dashed border-border-subtle px-4 py-3 text-xs text-fg-muted">
      Add a trigger and your first step.
    </p>
  )
}

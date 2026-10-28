import { expressionPaths, isKnownRoot } from './expressions'
import {
  type FlowGraph,
  flowGraphSchema,
  isCondition,
  isTrigger,
  MAX_FLOW_NODES,
  nodeSchema,
  outputsOf,
} from './graph'

export const FLOW_ISSUE_CODES = [
  'FLOW_TRIGGER_COUNT',
  'FLOW_UNREACHABLE_NODE',
  'FLOW_NODE_CONFIG_INVALID',
  'FLOW_CONDITION_BRANCHES',
  'FLOW_DANGLING_NODE',
  'FLOW_CYCLE_WITHOUT_DELAY',
  'FLOW_TEMPLATE_NOT_APPROVED',
  'FLOW_REFERENCE_MISSING',
  'FLOW_TOO_LARGE',
  'FLOW_EDGE_INVALID',
  'FLOW_EXPRESSION_INVALID',
  'FLOW_AI_NOT_ENABLED',
  'FLOW_AI_NO_KNOWLEDGE',
  'FLOW_AI_QUOTA',
] as const
export type FlowIssueCode = (typeof FLOW_ISSUE_CODES)[number]
export type FlowIssue = { code: FlowIssueCode; message: string; nodeId?: string; edgeId?: string }
/** `warnings` never block publishing (e.g. the AI quota is used up for this month). */
export type FlowValidation = { valid: boolean; errors: FlowIssue[]; warnings?: FlowIssue[] }

/**
 * The shared publish gate (docs/AUTOMATION_ENGINE.md → Validation), run by the builder live and by
 * the API before publish. Reference checks (templates, tags, users, properties) are added by the
 * server, which can see the tenant's data.
 */
export function validateFlowGraph(input: unknown): FlowValidation {
  const errors: FlowIssue[] = []
  const parsed = flowGraphSchema.safeParse(input)
  if (!parsed.success) {
    // Pinpoint node-level config problems; anything else is structural.
    const raw = (input ?? {}) as { nodes?: Array<{ id?: string }> }
    for (const n of raw.nodes ?? []) {
      const r = nodeSchema.safeParse(n)
      if (!r.success)
        errors.push({
          code: 'FLOW_NODE_CONFIG_INVALID',
          nodeId: n.id,
          message: r.error.issues[0]?.message ?? 'This step is not set up correctly.',
        })
    }
    if (!errors.length)
      errors.push({
        code: 'FLOW_NODE_CONFIG_INVALID',
        message: parsed.error.issues[0]?.message ?? 'Invalid flow.',
      })
    return { valid: false, errors }
  }
  const g: FlowGraph = parsed.data
  const ids = new Set(g.nodes.map((n) => n.id))
  const byId = new Map(g.nodes.map((n) => [n.id, n]))
  if (g.nodes.length > MAX_FLOW_NODES)
    errors.push({
      code: 'FLOW_TOO_LARGE',
      message: `A flow can have at most ${MAX_FLOW_NODES} steps.`,
    })
  if (ids.size !== g.nodes.length)
    errors.push({ code: 'FLOW_NODE_CONFIG_INVALID', message: 'Two steps share an id.' })

  const triggers = g.nodes.filter((n) => isTrigger(n.type))
  if (triggers.length !== 1)
    errors.push({ code: 'FLOW_TRIGGER_COUNT', message: 'A flow needs exactly one trigger.' })
  for (const e of g.edges) {
    const src = byId.get(e.source)
    if (!src || !ids.has(e.target) || !outputsOf(src.type).includes(e.sourceHandle))
      errors.push({
        code: 'FLOW_EDGE_INVALID',
        edgeId: e.id,
        message: 'This connection is not valid.',
      })
    else if (triggers.some((t) => t.id === e.target))
      errors.push({
        code: 'FLOW_TRIGGER_COUNT',
        edgeId: e.id,
        nodeId: e.target,
        message: 'Nothing can lead into the trigger.',
      })
  }
  const out = (nodeId: string, handle: string) =>
    g.edges.filter((e) => e.source === nodeId && e.sourceHandle === handle)
  for (const n of g.nodes) {
    if (n.type === 'action.ai_reply') {
      for (const [handle, label] of [
        ['replied', 'Replied'],
        ['needs_human', 'Needs a human'],
        ['error', 'Error'],
      ] as const)
        if (out(n.id, handle).length !== 1)
          errors.push({
            code: 'FLOW_DANGLING_NODE',
            nodeId: n.id,
            message: `Connect the ${label} path (to the next step or an End).`,
          })
    } else if (isCondition(n.type)) {
      if (out(n.id, 'yes').length !== 1 || out(n.id, 'no').length !== 1)
        errors.push({
          code: 'FLOW_CONDITION_BRANCHES',
          nodeId: n.id,
          message: 'Connect both the Yes and the No path.',
        })
    } else if (n.type !== 'action.end') {
      if (out(n.id, 'next').length !== 1)
        errors.push({
          code: 'FLOW_DANGLING_NODE',
          nodeId: n.id,
          message: 'Connect this step to the next one (or an End).',
        })
    }
    if (out(n.id, 'error').length > 1)
      errors.push({
        code: 'FLOW_EDGE_INVALID',
        nodeId: n.id,
        message: 'A step can have one error path.',
      })
    // Expressions may only read known roots.
    for (const text of Object.values(n.config as Record<string, unknown>).flatMap(strings))
      for (const p of expressionPaths(text))
        if (!isKnownRoot(p))
          errors.push({
            code: 'FLOW_EXPRESSION_INVALID',
            nodeId: n.id,
            message: `Unknown value {{${p}}}.`,
          })
  }

  // Reachability from the trigger.
  if (triggers.length === 1) {
    const seen = new Set<string>()
    const stack = [triggers[0]!.id]
    while (stack.length) {
      const cur = stack.pop()!
      if (seen.has(cur)) continue
      seen.add(cur)
      for (const e of g.edges) if (e.source === cur) stack.push(e.target)
    }
    for (const n of g.nodes)
      if (!seen.has(n.id))
        errors.push({
          code: 'FLOW_UNREACHABLE_NODE',
          nodeId: n.id,
          message: 'Nothing leads to this step.',
        })
  }

  // Cycles are allowed only through a delay: search for a cycle among non-delay nodes.
  const nonDelay = g.nodes.filter((n) => n.type !== 'action.delay').map((n) => n.id)
  const state = new Map<string, 0 | 1 | 2>()
  const cyc = new Set<string>()
  const visit = (v: string): boolean => {
    state.set(v, 1)
    for (const e of g.edges) {
      if (e.source !== v || byId.get(e.target)?.type === 'action.delay') continue
      const s = state.get(e.target) ?? 0
      if (s === 1 || (s === 0 && visit(e.target))) {
        cyc.add(v)
        return true
      }
    }
    state.set(v, 2)
    return false
  }
  for (const v of nonDelay) if (!state.get(v)) visit(v)
  for (const v of cyc)
    errors.push({
      code: 'FLOW_CYCLE_WITHOUT_DELAY',
      nodeId: v,
      message: 'Loops must pass through a Delay step.',
    })

  return { valid: errors.length === 0, errors }
}

function strings(v: unknown): string[] {
  if (typeof v === 'string') return [v]
  if (Array.isArray(v)) return v.flatMap(strings)
  if (v && typeof v === 'object') return Object.values(v).flatMap(strings)
  return []
}

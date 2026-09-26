'use client'

import {
  type DraftGraph,
  type EdgeHandle,
  type Execution,
  type ExecutionStep,
  type Flow,
  type FlowIssue,
  type FlowVersion,
  isCondition,
  isTrigger,
  type NodeType,
  outputsOf,
  type TriggerRun,
} from '@fenwira/contracts'
import dagre from '@dagrejs/dagre'
import { useQuery } from '@tanstack/react-query'
import { useSession } from '@/components/session/session-provider'
import { get } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'

/** Automation builder data and helpers (docs/AUTOMATION_ENGINE.md). */

export const automationKey = (tenantId: string, ...rest: string[]) =>
  keys.tenant(tenantId, 'automation', ...rest)

export type DraftNode = DraftGraph['nodes'][number]
export type DraftEdge = DraftGraph['edges'][number]
export type ExecutionDetail = Execution & { steps: ExecutionStep[] }

export function useFlows() {
  const { tenantId } = useSession()
  return useQuery({
    queryKey: automationKey(tenantId, 'flows'),
    queryFn: () => get<{ data: Flow[] }>('/flows').then((r) => r.data),
  })
}

export function useFlow(id: string) {
  const { tenantId } = useSession()
  return useQuery({
    queryKey: automationKey(tenantId, 'flow', id),
    queryFn: () => get<{ data: Flow }>(`/flows/${id}`).then((r) => r.data),
  })
}

export function useDraft(id: string) {
  const { tenantId } = useSession()
  return useQuery({
    queryKey: automationKey(tenantId, 'draft', id),
    queryFn: () => get<{ data: FlowVersion }>(`/flows/${id}/draft`).then((r) => r.data),
    refetchOnWindowFocus: false,
  })
}

export function useVersion(flowId: string, versionId: string | undefined) {
  const { tenantId } = useSession()
  return useQuery({
    queryKey: automationKey(tenantId, 'version', versionId ?? 'none'),
    queryFn: () =>
      get<{ data: FlowVersion }>(`/flows/${flowId}/versions/${versionId}`).then((r) => r.data),
    enabled: !!versionId,
  })
}

const LIVE: Execution['status'][] = ['RUNNING', 'WAITING']

export function useExecutions(flowId: string) {
  const { tenantId } = useSession()
  return useQuery({
    queryKey: automationKey(tenantId, 'executions', flowId),
    queryFn: () =>
      get<{ data: Execution[] }>(`/flows/${flowId}/executions?limit=100`).then((r) => r.data),
    refetchInterval: (q) => (q.state.data?.some((e) => LIVE.includes(e.status)) ? 3000 : 15_000),
  })
}

export function useExecution(id: string) {
  const { tenantId } = useSession()
  return useQuery({
    queryKey: automationKey(tenantId, 'execution', id),
    queryFn: () => get<{ data: ExecutionDetail }>(`/executions/${id}`).then((r) => r.data),
    refetchInterval: (q) => (q.state.data && LIVE.includes(q.state.data.status) ? 2000 : false),
  })
}

export function useTriggerRun(flowId: string, runId: string | null) {
  const { tenantId } = useSession()
  return useQuery({
    queryKey: automationKey(tenantId, 'run', runId ?? 'none'),
    queryFn: () =>
      get<{ data: TriggerRun }>(`/flows/${flowId}/trigger-runs/${runId}`).then((r) => r.data),
    enabled: !!runId,
  })
}

// ------------------------------------------------------------------------------ node catalog

export type Category = 'trigger' | 'condition' | 'message' | 'action'

export const categoryOf = (t: NodeType): Category =>
  isTrigger(t)
    ? 'trigger'
    : isCondition(t)
      ? 'condition'
      : t === 'action.send_message' || t === 'action.send_template'
        ? 'message'
        : 'action'

export const NODE_LABEL: Record<NodeType, string> = {
  'trigger.message_received': 'Message received',
  'trigger.keyword': 'Keyword',
  'trigger.contact_created': 'Contact created',
  'trigger.webhook': 'Incoming webhook',
  'condition.equals': 'If value equals',
  'condition.contains': 'If value contains',
  'condition.exists': 'If value is set',
  'condition.has_tag': 'If contact has tag',
  'condition.contact_property': 'If contact field',
  'action.send_message': 'Send message',
  'action.send_template': 'Send template',
  'action.add_tag': 'Add tag',
  'action.remove_tag': 'Remove tag',
  'action.assign_agent': 'Assign conversation',
  'action.update_contact': 'Update contact',
  'action.webhook': 'Call webhook',
  'action.delay': 'Wait',
  'action.end': 'End',
}

export const HANDLE_LABEL: Record<EdgeHandle, string> = {
  next: 'Next',
  yes: 'Yes',
  no: 'No',
  error: 'If it fails',
}

/** Palette order. Triggers only while the flow has none (exactly one per flow). */
export const PALETTE: Array<{ category: Category; title: string; types: NodeType[] }> = [
  {
    category: 'trigger',
    title: 'Triggers',
    types: [
      'trigger.keyword',
      'trigger.message_received',
      'trigger.contact_created',
      'trigger.webhook',
    ],
  },
  {
    category: 'message',
    title: 'Messages',
    types: ['action.send_message', 'action.send_template'],
  },
  {
    category: 'condition',
    title: 'Conditions',
    types: [
      'condition.has_tag',
      'condition.equals',
      'condition.contains',
      'condition.exists',
      'condition.contact_property',
    ],
  },
  {
    category: 'action',
    title: 'Actions',
    types: [
      'action.add_tag',
      'action.remove_tag',
      'action.assign_agent',
      'action.update_contact',
      'action.webhook',
      'action.delay',
      'action.end',
    ],
  },
]

export const DEFAULT_CONFIG: Record<NodeType, Record<string, unknown>> = {
  'trigger.message_received': { onlyNewConversation: false },
  'trigger.keyword': { keywords: [], match: 'EXACT', caseSensitive: false },
  'trigger.contact_created': {},
  'trigger.webhook': { contactPhonePath: 'phone', requireSignature: true },
  'condition.equals': { subject: '', value: '', caseSensitive: false },
  'condition.contains': { subject: '', value: '', caseSensitive: false },
  'condition.exists': { subject: '' },
  'condition.has_tag': { tagIds: [], match: 'ANY' },
  'condition.contact_property': { key: '', operator: 'EQUALS', value: '' },
  'action.send_message': { text: '' },
  'action.send_template': { templateId: '', variables: { body: [] } },
  'action.add_tag': { tagIds: [] },
  'action.remove_tag': { tagIds: [] },
  'action.assign_agent': { mode: 'ROUND_ROBIN' },
  'action.update_contact': { updates: [{ field: 'name', value: '' }] },
  'action.webhook': { method: 'POST', url: 'https://', timeoutMs: 5000 },
  'action.delay': { amount: 1, unit: 'HOURS' },
  'action.end': {},
}

/** Values the expression chips offer (`{{…}}`). */
export const EXPRESSION_PATHS = [
  { path: 'contact.firstName', label: 'First name' },
  { path: 'contact.name', label: 'Full name' },
  { path: 'contact.phone', label: 'Phone' },
  { path: 'contact.email', label: 'Email' },
  { path: 'trigger.message.text', label: 'Message text' },
]

let seq = 0
export const newNodeId = () =>
  `n${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`

/** One line describing what a node does (canvas cards and the outline). */
export function summarize(node: DraftNode): string {
  const c = node.config as Record<string, unknown>
  const list = (v: unknown) => (Array.isArray(v) ? v.length : 0)
  switch (node.type) {
    case 'trigger.keyword': {
      const k = (c.keywords as string[] | undefined) ?? []
      return k.length ? `When a message is ${k.map((x) => `“${x}”`).join(', ')}` : 'Add keywords'
    }
    case 'trigger.message_received':
      return c.onlyNewConversation ? 'First message of a conversation' : 'Any incoming message'
    case 'trigger.contact_created':
      return 'When a contact is added'
    case 'trigger.webhook':
      return `Phone at “${String(c.contactPhonePath ?? '')}”`
    case 'condition.equals':
    case 'condition.contains':
      return `${String(c.subject ?? '') || '…'} ${node.type === 'condition.equals' ? '=' : 'contains'} ${String(c.value ?? '') || '…'}`
    case 'condition.exists':
      return `${String(c.subject ?? '') || '…'} is set`
    case 'condition.has_tag':
      return `${list(c.tagIds)} tag(s), ${c.match === 'ALL' ? 'all' : 'any'}`
    case 'condition.contact_property':
      return `${String(c.key ?? '') || '…'} ${String(c.operator ?? '')
        .toLowerCase()
        .replaceAll('_', ' ')}`
    case 'action.send_message':
      return String(c.text ?? '').slice(0, 60) || 'Write a message'
    case 'action.send_template':
      return c.templateId ? 'Approved template' : 'Choose a template'
    case 'action.add_tag':
    case 'action.remove_tag':
      return `${list(c.tagIds)} tag(s)`
    case 'action.assign_agent':
      return c.mode === 'USER' ? 'To a teammate' : 'Round robin to who is online'
    case 'action.update_contact':
      return `${list(c.updates)} field(s)`
    case 'action.webhook':
      return `${String(c.method ?? 'POST')} ${String(c.url ?? '')}`.slice(0, 60)
    case 'action.delay':
      return `${String(c.amount ?? '')} ${String(c.unit ?? '').toLowerCase()}`
    case 'action.end':
      return 'Finish the automation'
  }
}

// ------------------------------------------------------------------------------ graph helpers

export const outgoing = (g: DraftGraph, nodeId: string, handle: EdgeHandle) =>
  g.edges.find((e) => e.source === nodeId && e.sourceHandle === handle)

/** Sets (or clears, with null) the target of one output handle. */
export function connect(
  g: DraftGraph,
  source: string,
  handle: EdgeHandle,
  target: string | null,
): DraftGraph {
  const edges = g.edges.filter((e) => !(e.source === source && e.sourceHandle === handle))
  if (target) edges.push({ id: `e-${source}-${handle}`, source, target, sourceHandle: handle })
  return { ...g, edges }
}

export function removeNode(g: DraftGraph, id: string): DraftGraph {
  const layout = { ...g.layout }
  delete layout[id]
  return {
    nodes: g.nodes.filter((n) => n.id !== id),
    edges: g.edges.filter((e) => e.source !== id && e.target !== id),
    layout,
  }
}

/** Adds a node below `after` and, when that output is free, connects it. */
export function addNode(
  g: DraftGraph,
  type: NodeType,
  after?: string,
): { graph: DraftGraph; id: string } {
  const id = newNodeId()
  const base = after ? g.layout[after] : undefined
  const lowest = Math.max(0, ...Object.values(g.layout).map((p) => p.y))
  const position = base
    ? { x: base.x, y: base.y + 140 }
    : { x: 0, y: g.nodes.length ? lowest + 140 : 0 }
  let graph: DraftGraph = {
    ...g,
    nodes: [...g.nodes, { id, type, config: structuredClone(DEFAULT_CONFIG[type]) }],
    layout: { ...g.layout, [id]: position },
  }
  if (after && !isTrigger(type)) {
    const src = g.nodes.find((n) => n.id === after)
    const free = src && outputsOf(src.type).find((h) => h !== 'error' && !outgoing(g, after, h))
    if (free) graph = connect(graph, after, free, id)
  }
  return { graph, id }
}

/** Top-to-bottom auto layout (dagre). Only `layout` changes. */
export function autoLayout(g: DraftGraph): DraftGraph {
  const d = new dagre.graphlib.Graph()
  d.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 70 })
  d.setDefaultEdgeLabel(() => ({}))
  for (const n of g.nodes) d.setNode(n.id, { width: 240, height: 84 })
  for (const e of g.edges) d.setEdge(e.source, e.target)
  dagre.layout(d)
  const layout: DraftGraph['layout'] = {}
  for (const n of g.nodes) {
    const p = d.node(n.id)
    layout[n.id] = { x: Math.round(p.x - 120), y: Math.round(p.y - 42) }
  }
  return { ...g, layout }
}

/** Nodes in reading order: breadth-first from the trigger, then anything unreachable. */
export function readingOrder(g: DraftGraph): DraftNode[] {
  const trigger = g.nodes.find((n) => isTrigger(n.type))
  const seen = new Set<string>()
  const out: DraftNode[] = []
  const queue = trigger ? [trigger.id] : []
  const order: EdgeHandle[] = ['next', 'yes', 'no', 'error']
  while (queue.length) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    const n = g.nodes.find((x) => x.id === id)
    if (!n) continue
    out.push(n)
    for (const h of order) {
      const e = outgoing(g, id, h)
      if (e) queue.push(e.target)
    }
  }
  for (const n of g.nodes) if (!seen.has(n.id)) out.push(n)
  return out
}

export const issuesFor = (issues: FlowIssue[], nodeId: string) =>
  issues.filter((i) => i.nodeId === nodeId)

export const RUN_REASON: Record<string, string> = {
  FLOW_NOT_ACTIVE: 'The flow was paused or archived.',
  REENTRY_ONCE_PER_CONTACT: 'Runs once per contact.',
  REENTRY_ACTIVE_EXECUTION: 'Already running for this conversation.',
  AGENT_TAKEOVER: 'An agent took over the conversation.',
  AUTOMATION_PAUSED: 'Automation is paused for this conversation.',
  automation_execution_limit: 'The monthly automation limit is reached.',
  automation_enabled: 'Automations are not enabled for this workspace.',
}

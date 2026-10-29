'use client'

import {
  type DraftGraph,
  type EdgeHandle,
  type Execution,
  type ExecutionStep,
  type Flow,
  FLOW_TEMPLATES,
  type FlowIssue,
  type FlowNodeStats,
  type FlowSetupStep,
  flowSetupDone,
  type FlowVersion,
  isCondition,
  isTrigger,
  type NodeType,
  outputsOf,
  type REENTRY_POLICIES,
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

export function useFlows(archived = false) {
  const { tenantId } = useSession()
  return useQuery({
    queryKey: archived
      ? automationKey(tenantId, 'flows', 'archived')
      : automationKey(tenantId, 'flows'),
    queryFn: () =>
      get<{ data: Flow[] }>(archived ? '/flows?archived=true' : '/flows').then((r) => r.data),
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

export function useNodeStats(flowId: string, enabled: boolean) {
  const { tenantId } = useSession()
  return useQuery({
    queryKey: automationKey(tenantId, 'node-stats', flowId),
    queryFn: () => get<{ data: FlowNodeStats }>(`/flows/${flowId}/node-stats`).then((r) => r.data),
    enabled,
  })
}

// ------------------------------------------------------------------------------ node catalog

export type Category = 'trigger' | 'condition' | 'message' | 'action'

export const categoryOf = (t: NodeType): Category =>
  isTrigger(t)
    ? 'trigger'
    : isCondition(t)
      ? 'condition'
      : t === 'action.send_message' || t === 'action.send_template' || t === 'action.ai_reply'
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
  'action.send_message': 'Message',
  'action.send_template': 'Send template',
  'action.add_tag': 'Add tag',
  'action.remove_tag': 'Remove tag',
  'action.assign_agent': 'Assign conversation',
  'action.update_contact': 'Update contact',
  'action.webhook': 'Call webhook',
  'action.delay': 'Wait',
  'action.ai_reply': 'AI reply',
  'condition.business_hours': 'Business hours',
  'action.question': 'Question',
  'action.options': 'Options',
  'action.handover': 'Handover',
  'action.end': 'End',
}

export const HANDLE_LABEL: Record<EdgeHandle, string> = {
  next: 'Next',
  yes: 'Yes',
  no: 'No',
  error: 'If it fails',
  replied: 'Replied',
  needs_human: 'Needs a human',
}

/** Labels describe the node's actual outputs; persisted handle IDs remain unchanged. */
export function branchLabel(node: DraftNode, handle: EdgeHandle): string {
  if (node.type === 'condition.business_hours')
    return handle === 'yes' ? 'Open' : handle === 'no' ? 'Closed' : HANDLE_LABEL[handle]
  if (node.type === 'action.question' || node.type === 'action.options') {
    if (handle === 'error') return 'Invalid / fallback'
    if (handle === 'next')
      return node.type === 'action.options'
        ? `Valid: ${((node.config.options as Array<{ label: string }>) ?? []).map((o) => o.label).join(' / ')}`
        : 'Valid answer'
  }
  return HANDLE_LABEL[handle]
}

/** Palette order. Triggers only while the flow has none (exactly one per flow). */
export const PALETTE: Array<{ category: Category; title: string; types: NodeType[] }> = [
  {
    category: 'trigger',
    title: 'Start',
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
    types: [
      'action.send_message',
      'action.options',
      'action.question',
      'action.send_template',
      'action.ai_reply',
    ],
  },
  {
    category: 'condition',
    title: 'Conditions',
    types: [
      'condition.business_hours',
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
      'action.handover',
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

/** Card colour family (design system → Flow nodes): AI is an action with its own sparkle. */
export type NodeKind = 'trigger' | 'message' | 'condition' | 'action' | 'ai'
export const kindOf = (t: NodeType): NodeKind => (t === 'action.ai_reply' ? 'ai' : categoryOf(t))
export const KIND_LABEL: Record<NodeKind, string> = {
  trigger: 'Trigger',
  message: 'Message',
  condition: 'Condition',
  action: 'Action',
  ai: 'AI',
}

/** The "+" menu on the canvas: Triggers, Conditions, Actions (messages included) and AI. */
export const ADD_MENU: Array<{ title: string; types: NodeType[] }> = [
  { title: 'Start', types: PALETTE[0]!.types },
  { title: 'Conditions', types: PALETTE[2]!.types },
  {
    title: 'Actions',
    types: [
      'action.send_message',
      'action.options',
      'action.question',
      'action.send_template',
      ...PALETTE[3]!.types,
    ],
  },
  { title: 'AI', types: ['action.ai_reply'] },
]

/** Re-entry policies in plain language (the stored values are unchanged). */
export const REENTRY_OPTIONS: Array<{
  value: (typeof REENTRY_POLICIES)[number]
  label: string
  hint: string
}> = [
  {
    value: 'ALWAYS',
    label: 'Every time it matches',
    hint: 'Runs for every matching message or event, even if one is already running.',
  },
  {
    value: 'ONCE_PER_CONTACT',
    label: 'Only the first time for each contact',
    hint: 'Each contact goes through this automation once, ever.',
  },
  {
    value: 'AFTER_COMPLETION',
    label: 'Not while one is already running for this chat',
    hint: 'Starts again only after the previous run in this conversation has finished.',
  },
]
export const PRIORITY_HINT =
  'When several automations match the same message, lower numbers run first. Keyword automations always win over Message received.'

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
  'action.ai_reply': { mode: 'CONVERSATION' },
  'condition.business_hours': {},
  'action.question': { text: '', field: 'answer', answerType: 'TEXT', maxRetries: 2 },
  'action.options': {
    text: '',
    field: 'choice',
    presentation: 'BUTTONS',
    options: [],
    maxRetries: 2,
  },
  'action.handover': { note: 'Customer enquiry', tagIds: [] },
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
    case 'action.question':
      return `Ask and save as ${String(c.field ?? 'answer')}`
    case 'action.options':
      return `Offer ${list(c.options)} options and wait`
    case 'action.handover':
      return 'Assign the enquiry and add a private note'
    case 'condition.business_hours':
      return 'Yes when open, No when closed'
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
    case 'action.ai_reply':
      return c.mode === 'SINGLE'
        ? 'Answer once from your knowledge'
        : 'Answer each message from your knowledge'
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
    ...g,
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

/**
 * Inserts a node on an output: `source --handle--> new`, and whatever that output led to before
 * now follows the new node's first output (Yes for conditions). Used by the canvas "+" buttons.
 */
export function insertNode(
  g: DraftGraph,
  type: NodeType,
  source: string,
  handle: EdgeHandle,
): { graph: DraftGraph; id: string } {
  const id = newNodeId()
  const previous = outgoing(g, source, handle)?.target ?? null
  let graph: DraftGraph = {
    ...g,
    nodes: [...g.nodes, { id, type, config: structuredClone(DEFAULT_CONFIG[type]) }],
  }
  graph = connect(graph, source, handle, id)
  const out = outputsOf(type).find((h) => h !== 'error')
  if (previous && out) graph = connect(graph, id, out, previous)
  return { graph: autoLayout(graph), id }
}

/** Adds the trigger to an empty flow (the canvas's "Add a trigger" button). */
export function addTrigger(g: DraftGraph, type: NodeType): { graph: DraftGraph; id: string } {
  const r = addNode(g, type)
  return { graph: autoLayout(r.graph), id: r.id }
}

/** Top-to-bottom auto layout (dagre). Only `layout` changes. */
export function autoLayout(g: DraftGraph): DraftGraph {
  const d = new dagre.graphlib.Graph()
  d.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 56 })
  d.setDefaultEdgeLabel(() => ({}))
  // Cards are w-64; labelled outputs (Yes/No, If it fails) make them up to ~136px tall.
  for (const n of g.nodes) d.setNode(n.id, { width: 256, height: 136 })
  for (const e of g.edges) d.setEdge(e.source, e.target)
  dagre.layout(d)
  const layout: DraftGraph['layout'] = {}
  for (const n of g.nodes) {
    const p = d.node(n.id)
    layout[n.id] = { x: Math.round(p.x - 128), y: Math.round(p.y - 68) }
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

/** What each kind of step needs before it can run: the generic setup checklist. */
const SETUP_BY_TYPE: Partial<Record<NodeType, Omit<FlowSetupStep, 'nodeId'>>> = {
  'trigger.keyword': { kind: 'keywords', label: 'Set the keywords' },
  'trigger.webhook': { kind: 'webhook_phone', label: 'Say where the phone number is' },
  'action.send_template': { kind: 'template', label: 'Pick the approved template' },
  'action.send_message': { kind: 'message', label: 'Write the message' },
  'action.add_tag': { kind: 'tags', label: 'Choose the tag to add' },
  'action.remove_tag': { kind: 'tags', label: 'Choose the tag to remove' },
  'condition.has_tag': { kind: 'condition_tag', label: 'Choose the tag to check' },
  'action.assign_agent': { kind: 'agent', label: 'Choose who gets the conversation' },
  'action.delay': { kind: 'delay', label: 'Choose how long to wait' },
}

export type SetupItem = FlowSetupStep & { done: boolean }

/**
 * The "Set up your automation" checklist: the template's own steps (better labels and suggested
 * tag names) when the flow was started from one, then a generic step for every other node that
 * needs input. An item is done when its value is set and the validator has nothing on that node.
 */
export function setupChecklist(
  g: DraftGraph,
  issues: FlowIssue[],
  templateId?: string | null,
): SetupItem[] {
  const fromTemplate = FLOW_TEMPLATES.find((t) => t.id === templateId)?.setup ?? []
  const steps: FlowSetupStep[] = fromTemplate.filter((s) => g.nodes.some((n) => n.id === s.nodeId))
  for (const n of readingOrder(g)) {
    const generic = SETUP_BY_TYPE[n.type]
    if (generic && !steps.some((s) => s.nodeId === n.id)) steps.push({ ...generic, nodeId: n.id })
  }
  return steps.map((s) => {
    const node = g.nodes.find((n) => n.id === s.nodeId)
    return {
      ...s,
      done: flowSetupDone(s, node) && !issues.some((i) => i.nodeId === s.nodeId),
    }
  })
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

/** Plain-language wording for config problems; structural messages are already plain. */
const CONFIG_HINT: Partial<Record<NodeType, string>> = {
  'trigger.keyword': 'Add at least one keyword.',
  'trigger.webhook': 'Say where the phone number is in your system’s data.',
  'condition.equals': 'Fill in what to check and the value to compare with.',
  'condition.contains': 'Fill in what to check and the text to look for.',
  'condition.exists': 'Choose the value to check.',
  'condition.has_tag': 'Choose at least one tag to check.',
  'condition.contact_property': 'Choose a contact field and a condition.',
  'action.send_message': 'Write a message, or choose a file.',
  'action.send_template': 'Pick an approved template.',
  'action.add_tag': 'Choose at least one tag to add.',
  'action.remove_tag': 'Choose at least one tag to remove.',
  'action.update_contact': 'Choose the fields to update.',
  'action.webhook': 'Enter the address of your system (https).',
  'action.delay': 'Enter how long to wait.',
}

export function plainIssue(issue: FlowIssue, node?: DraftNode): string {
  if (issue.code === 'FLOW_NODE_CONFIG_INVALID' && node && CONFIG_HINT[node.type])
    return CONFIG_HINT[node.type]!
  return issue.message
}

/** The step a problem belongs to: its node, or the start of its connection. */
export function issueNodeId(g: DraftGraph, issue: FlowIssue): string | undefined {
  if (issue.nodeId) return issue.nodeId
  return issue.edgeId ? g.edges.find((e) => e.id === issue.edgeId)?.source : undefined
}

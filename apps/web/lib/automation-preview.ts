import {
  type ApprovedTemplate,
  type DraftGraph,
  type EdgeHandle,
  type FlowIssue,
  type MessageTemplateSnapshot,
  type TemplateVariables,
  isCondition,
  isTrigger,
  outputsOf,
  renderTemplateSnapshot,
} from '@fenwira/contracts'

export type SampleContact = { name: string; phone: string; properties: Record<string, string> }
export type PreviewPart = { text: string; missing?: string }
export type PreviewStep = {
  nodeId: string
  kind: 'incoming' | 'outgoing' | 'template' | 'system' | 'condition' | 'ai' | 'warning'
  text: string
  snapshot?: MessageTemplateSnapshot
  branch?: 'yes' | 'no'
  reason?: string
  warnings: string[]
}
export type PreviewOptions = {
  contact: SampleContact
  incoming?: string
  paths?: Record<string, 'yes' | 'no'>
  templates?: readonly ApprovedTemplate[]
  issues?: readonly FlowIssue[]
  tagName?: (id: string) => string | undefined
  memberName?: (id: string) => string | undefined
}

const missing = (path: string) => `⟦missing:${path}⟧`
/** Strings stay plain text; the renderer turns only explicit missing markers into accessible chips. */
export function previewParts(text: string): PreviewPart[] {
  return text
    .split(/(⟦missing:[^⟧]+⟧|\{\{\s*\d+\s*\}\})/g)
    .filter(Boolean)
    .map((part) => {
      if (part.startsWith('⟦missing:')) return { text: '', missing: part.slice(9, -1) }
      if (/^\{\{\s*\d+\s*\}\}$/.test(part)) return { text: '', missing: part.slice(2, -2).trim() }
      return { text: part }
    })
}

export function substitutePreview(text: string, contact: SampleContact, incoming = ''): string {
  const values: Record<string, string> = {
    'contact.name': contact.name,
    'contact.firstName': contact.name.trim().split(/\s+/)[0] ?? '',
    'contact.phone': contact.phone,
    'trigger.message.text': incoming,
  }
  for (const [key, value] of Object.entries(contact.properties)) {
    values[`contact.${key}`] = value
    values[`contact.property.${key}`] = value
    values[`contact.properties.${key}`] = value
  }
  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, path: string) =>
    Object.hasOwn(values, path) && values[path]?.trim() ? values[path]! : missing(path),
  )
}

const textOf = (value: unknown) => (typeof value === 'string' ? value : '')
const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []

/** A bounded visual walk through the current draft. It never runs the engine or performs I/O. */
export function draftToPreview(graph: DraftGraph, options: PreviewOptions): PreviewStep[] {
  const steps: PreviewStep[] = []
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]))
  let node = graph.nodes.find((candidate) => isTrigger(candidate.type))
  if (!node) return []
  const visited = new Set<string>()
  const contact = { ...options.contact, properties: { ...options.contact.properties } }
  const incoming = options.incoming ?? stringList(node.config.keywords)[0] ?? 'Hello'
  const fill = (value: unknown) => substitutePreview(textOf(value), contact, incoming)
  for (let count = 0; node && count < 30; count++) {
    if (visited.has(node.id)) {
      steps.push({ nodeId: node.id, kind: 'system', text: 'Repeats', warnings: [] })
      return steps
    }
    visited.add(node.id)
    const config = node.config
    const step: PreviewStep = {
      nodeId: node.id,
      kind: 'system',
      text: '',
      warnings: (options.issues ?? [])
        .filter((issue) => issue.nodeId === node!.id)
        .map((issue) => issue.message),
    }
    let handle: EdgeHandle | undefined = outputsOf(node.type).find((output) => output !== 'error')
    if (isCondition(node.type)) {
      step.kind = 'condition'
      step.branch = options.paths?.[node.id] ?? 'yes'
      handle = step.branch
      step.text = `Preview path: ${step.branch === 'yes' ? 'Yes' : 'No'}`
      step.reason = `Showing the ${step.branch === 'yes' ? 'Yes' : 'No'} branch you chose for this visual preview. Test evaluates the real condition.`
    } else
      switch (node.type) {
        case 'trigger.message_received':
        case 'trigger.keyword':
          step.kind = 'incoming'
          step.text = incoming
          break
        case 'trigger.contact_created':
          step.text = 'New contact created'
          break
        case 'trigger.webhook':
          step.text = 'Webhook received'
          break
        case 'action.question':
        case 'action.options':
          step.kind = 'outgoing'
          step.text = `${fill(config.text)} (waits for an answer)`
          break
        case 'action.handover':
          step.text = 'Hand the enquiry and collected answers to your team'
          break
        case 'action.send_message':
          step.kind = 'outgoing'
          step.text = fill(config.text || config.caption)
          if (config.mediaFileId)
            step.text = `Media attachment${step.text ? ` · ${step.text}` : ''}`
          if (!step.text) {
            step.kind = 'warning'
            step.text = 'Message not set'
          }
          break
        case 'action.send_template': {
          const template = options.templates?.find(
            (candidate) => candidate.templateId === config.templateId,
          )
          if (!template) {
            step.kind = 'warning'
            step.text = 'Template not set'
            break
          }
          const raw =
            config.variables && typeof config.variables === 'object'
              ? (config.variables as Record<string, unknown>)
              : {}
          const buttons =
            raw.buttons && typeof raw.buttons === 'object'
              ? (raw.buttons as Record<string, unknown>)
              : {}
          const variables: TemplateVariables = {
            body: stringList(raw.body).map(fill),
            header: stringList(raw.header).map(fill),
            buttons: Object.fromEntries(
              Object.entries(buttons).map(([key, values]) => [key, stringList(values).map(fill)]),
            ),
          }
          step.kind = 'template'
          step.text = template.name
          const header = template.components.header
          step.snapshot = renderTemplateSnapshot({
            name: template.name,
            language: template.language,
            category: template.category,
            components: template.components,
            values: variables,
            headerFile:
              header && header.format !== 'TEXT' && header.sampleFileId
                ? {
                    id: header.sampleFileId,
                    filename: null,
                    mimeType:
                      header.format === 'IMAGE'
                        ? 'image/*'
                        : header.format === 'VIDEO'
                          ? 'video/*'
                          : 'application/pdf',
                  }
                : null,
          })
          break
        }
        case 'action.delay': {
          const amount = Number(config.amount) || 1
          const unit = textOf(config.unit).toLowerCase().replace(/s$/, '') || 'hour'
          step.text = `${amount} ${unit}${amount === 1 ? '' : 's'} later`
          break
        }
        case 'action.add_tag':
        case 'action.remove_tag':
          step.text = `Tag ${node.type === 'action.add_tag' ? 'added' : 'removed'}: ${
            stringList(config.tagIds)
              .map((id) => options.tagName?.(id) ?? 'Unknown tag')
              .join(', ') || 'not set'
          }`
          break
        case 'action.assign_agent':
          step.text = `Assigned to ${config.mode === 'USER' ? (options.memberName?.(textOf(config.userId)) ?? 'selected teammate') : 'whoever is online'}`
          break
        case 'action.update_contact': {
          const updates = Array.isArray(config.updates)
            ? (config.updates as Array<{ field?: unknown; value?: unknown }>)
            : []
          step.text = `Contact updated: ${updates.map((update) => `${textOf(update.field)} → ${fill(update.value)}`).join(', ') || 'fields not set'}`
          for (const update of updates) {
            const field = textOf(update.field)
            const value = fill(update.value)
            if (field === 'name') contact.name = value
            else contact.properties[field.replace(/^property\./, '')] = value
          }
          break
        }
        case 'action.webhook':
          step.text = 'Calls your system (not run in preview)'
          break
        case 'action.ai_reply':
          step.kind = 'ai'
          step.text =
            'AI answers from your documents (preview only)\nA helpful answer based on your documents would appear here.'
          break
        case 'action.end':
          step.text = 'Flow ends'
          break
      }
    steps.push(step)
    const edge: DraftGraph['edges'][number] | undefined =
      handle &&
      graph.edges.find(
        (candidate) => candidate.source === node!.id && candidate.sourceHandle === handle,
      )
    node = edge ? nodes.get(edge.target) : undefined
  }
  if (node)
    steps.push({
      nodeId: node.id,
      kind: 'system',
      text: visited.has(node.id) ? 'Repeats' : 'Preview truncated',
      warnings: [],
    })
  return steps
}

/** Reveal a selected alternate-branch node without treating preview choices as draft changes. */
export function previewPathTo(
  graph: DraftGraph,
  selected: string,
): Record<string, 'yes' | 'no'> | null {
  const trigger = graph.nodes.find((node) => isTrigger(node.type))
  if (!trigger) return null
  const queue = [{ id: trigger.id, paths: {} as Record<string, 'yes' | 'no'> }]
  const visited = new Set<string>()
  while (queue.length) {
    const current = queue.shift()!
    if (current.id === selected) return current.paths
    if (visited.has(current.id)) continue
    visited.add(current.id)
    for (const edge of graph.edges.filter(
      (candidate) => candidate.source === current.id && candidate.sourceHandle !== 'error',
    )) {
      queue.push({
        id: edge.target,
        paths:
          edge.sourceHandle === 'yes' || edge.sourceHandle === 'no'
            ? { ...current.paths, [edge.source]: edge.sourceHandle }
            : current.paths,
      })
    }
  }
  return null
}

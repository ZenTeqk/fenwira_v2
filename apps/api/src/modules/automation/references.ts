import {
  type FlowGraph,
  flowGraphSchema,
  type FlowIssue,
  type FlowValidation,
  fieldKind,
  type Role,
  roleHasPermission,
  validateFlowGraph,
} from '@fenwira/contracts'
import { type TenantTx } from '@fenwira/database'
import { quotaState, readySourceCount } from '../ai'

/**
 * The publish gate on the server (docs/AUTOMATION_ENGINE.md → Validation): the shared structural
 * validator, plus reference checks that need the tenant's data — one query per kind.
 */
export async function validateWithReferences(tx: TenantTx, raw: unknown): Promise<FlowValidation> {
  const base = validateFlowGraph(raw)
  const parsed = flowGraphSchema.safeParse(raw)
  if (!parsed.success) return base
  const graph: FlowGraph = parsed.data
  const errors: FlowIssue[] = [...base.errors]
  const missing = (nodeId: string, message: string) =>
    errors.push({ code: 'FLOW_REFERENCE_MISSING', nodeId, message })

  const tagIds = new Set<string>()
  const templateIds = new Set<string>()
  const userIds = new Set<string>()
  const propertyKeys = new Set<string>()
  const fileIds = new Set<string>()
  const phoneIds = new Set<string>()
  for (const n of graph.nodes) {
    switch (n.type) {
      case 'action.handover':
        n.config.tagIds?.forEach((t) => tagIds.add(t))
        if (n.config.userId) userIds.add(n.config.userId)
        break
      case 'action.question':
        if (n.config.contactProperty) propertyKeys.add(n.config.contactProperty)
        break
      case 'condition.has_tag':
      case 'action.add_tag':
      case 'action.remove_tag':
        n.config.tagIds?.forEach((t) => tagIds.add(t))
        break
      case 'action.send_template':
        templateIds.add(n.config.templateId)
        break
      case 'action.assign_agent':
        if (n.config.mode === 'USER' && n.config.userId) userIds.add(n.config.userId)
        break
      case 'action.update_contact':
        for (const u of n.config.updates ?? [])
          if (u.field.startsWith('property.')) propertyKeys.add(u.field.slice(9))
        break
      case 'condition.contact_property':
        if (!fieldKind(n.config.key)) propertyKeys.add(n.config.key)
        break
      case 'action.send_message':
        if (n.config.mediaFileId) fileIds.add(n.config.mediaFileId)
        break
      case 'trigger.keyword':
      case 'trigger.message_received':
        n.config.phoneNumberIds?.forEach((p) => phoneIds.add(p))
        break
    }
  }
  const [tags, templates, members, properties, files, phones] = await Promise.all([
    tagIds.size
      ? tx.tag.findMany({ where: { id: { in: [...tagIds] } }, select: { id: true } })
      : [],
    templateIds.size
      ? tx.template.findMany({
          where: { id: { in: [...templateIds] }, deletedAt: null },
          select: { id: true, approvedVersionId: true },
        })
      : [],
    userIds.size
      ? tx.membership.findMany({
          where: { userId: { in: [...userIds] }, status: 'ACTIVE' },
          select: { userId: true, role: true },
        })
      : [],
    propertyKeys.size
      ? tx.contactPropertyDefinition.findMany({
          where: { key: { in: [...propertyKeys] }, archivedAt: null },
          select: { key: true },
        })
      : [],
    fileIds.size
      ? tx.file.findMany({
          where: { id: { in: [...fileIds] }, status: 'READY' },
          select: { id: true },
        })
      : [],
    phoneIds.size
      ? tx.whatsAppPhoneNumber.findMany({
          where: { id: { in: [...phoneIds] } },
          select: { id: true },
        })
      : [],
  ])
  const has = <T>(rows: T[], key: (r: T) => string) => new Set(rows.map(key))
  const tagSet = has(tags, (t) => t.id)
  const templateMap = new Map(templates.map((t) => [t.id, t]))
  const agents = has(
    members.filter((m) => roleHasPermission(m.role as Role, 'inbox.reply')),
    (m) => m.userId,
  )
  const propSet = has(properties, (p) => p.key)
  const fileSet = has(files, (f) => f.id)
  const phoneSet = has(phones, (p) => p.id)

  for (const n of graph.nodes) {
    switch (n.type) {
      case 'action.handover':
        if (n.config.tagIds.some((t) => !tagSet.has(t)))
          missing(n.id, 'Choose an existing enquiry tag.')
        if (n.config.userId && !agents.has(n.config.userId))
          missing(n.id, 'Choose an active teammate who can reply.')
        break
      case 'action.question':
        if (n.config.contactProperty && !propSet.has(n.config.contactProperty))
          missing(n.id, 'Choose an existing contact property.')
        break
      case 'condition.has_tag':
      case 'action.add_tag':
      case 'action.remove_tag':
        if (n.config.tagIds?.some((t) => !tagSet.has(t)))
          missing(n.id, 'A tag used here was deleted. Choose tags again.')
        break
      case 'action.send_template': {
        const t = templateMap.get(n.config.templateId)
        if (!t) missing(n.id, 'The template was deleted.')
        else if (!t.approvedVersionId)
          errors.push({
            code: 'FLOW_TEMPLATE_NOT_APPROVED',
            nodeId: n.id,
            message: 'This template has no approved version yet.',
          })
        break
      }
      case 'action.assign_agent':
        if (n.config.mode === 'USER' && n.config.userId && !agents.has(n.config.userId))
          missing(n.id, 'This teammate is no longer active or cannot reply.')
        break
      case 'action.update_contact':
        for (const u of n.config.updates ?? [])
          if (u.field.startsWith('property.') && !propSet.has(u.field.slice(9)))
            missing(n.id, `The contact property "${u.field.slice(9)}" does not exist.`)
        break
      case 'condition.contact_property':
        if (!fieldKind(n.config.key) && !propSet.has(n.config.key))
          missing(n.id, `The contact property "${n.config.key}" does not exist.`)
        break
      case 'action.send_message':
        if (n.config.mediaFileId && !fileSet.has(n.config.mediaFileId))
          missing(n.id, 'The attachment is missing or not uploaded yet.')
        break
      case 'trigger.keyword':
      case 'trigger.message_received':
        if (n.config.phoneNumberIds?.some((p) => !phoneSet.has(p)))
          missing(n.id, 'A WhatsApp number used here was removed.')
        break
    }
  }
  const warnings: FlowIssue[] = []
  const aiNodes = graph.nodes.filter((n) => n.type === 'action.ai_reply')
  if (aiNodes.length) {
    // RLS limits this to the bound workspace's own row.
    const settings = await tx.aiSettings.findFirst({ select: { tenantId: true, enabled: true } })
    const ready = settings?.enabled ? await readySourceCount(tx, settings.tenantId) : 0
    const quota = settings?.enabled ? await quotaState(tx, settings.tenantId) : null
    for (const n of aiNodes) {
      if (!settings?.enabled)
        errors.push({
          code: 'FLOW_AI_NOT_ENABLED',
          nodeId: n.id,
          message: 'AI Assistant is not enabled for this workspace.',
        })
      else if (!ready)
        errors.push({
          code: 'FLOW_AI_NO_KNOWLEDGE',
          nodeId: n.id,
          message:
            'Add at least one knowledge source on the AI Assistant page and wait until it is ready.',
        })
      if (quota && !quota.available)
        warnings.push({
          code: 'FLOW_AI_QUOTA',
          nodeId: n.id,
          message:
            'This month’s AI replies are used up: the step will hand conversations to your team.',
        })
    }
  }
  return { valid: errors.length === 0, errors, ...(warnings.length ? { warnings } : {}) }
}

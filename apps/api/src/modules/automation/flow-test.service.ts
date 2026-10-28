import {
  evaluateExpression,
  flowGraphSchema,
  type FlowNode,
  type FlowTestRequest,
  type FlowTestResult,
  type FlowTestStep,
  getPath,
  keywordMatches,
  renderTemplateText,
  validateFlowGraph,
} from '@fenwira/contracts'
import { type Prisma, type TenantTx } from '@fenwira/database'
import { Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { TenantDb } from '../../core/database/tenant-db'
import { AppError } from '../../core/http/app-error'
import { normalizePhone } from '../../core/phone'
import { AuditService } from '../audit'
import { coercePropertyValue } from '../contacts'
import { currentTenant } from '../tenancy'
import { type ExecutionRow, triggerNodeOf } from './automation.core'
import {
  type Context,
  edgeFrom,
  isExternal,
  loadContext,
  type Outcome,
  runInternal,
} from './engine'

/** A loop through a delay could run forever; a test stops here and says so. */
const MAX_TEST_STEPS = 50
const UNIT = { MINUTES: 'minute', HOURS: 'hour', DAYS: 'day' } as const

/** Carries the result out of the transaction that must never commit. */
class Rollback extends Error {
  constructor(readonly result: FlowTestResult) {
    super('flow test rollback')
  }
}

const quote = (s: string, max = 160) => `“${s.length > max ? `${s.slice(0, max - 1)}…` : s}”`
const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`

/**
 * Test run (docs/AUTOMATION_ENGINE.md → Test run). The saved draft runs against a sample contact
 * and event inside one tenant transaction that is always rolled back. Conditions, tags and contact
 * updates use the executor's own handlers (`runInternal`), so a sample made-up contact, its
 * changes and every activity row vanish with the rollback. Sends, webhooks, AI replies and
 * assignment are never performed: their rendered result is shown instead. No execution, usage or
 * outbox row survives; the only lasting record is one `automation.tested` audit entry.
 */
@Injectable()
export class FlowTestService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
  ) {}

  async run(flowId: string, request: FlowTestRequest): Promise<FlowTestResult> {
    let result: FlowTestResult | undefined
    try {
      await this.tenantDb.run(async (tx) => {
        throw new Rollback(await this.simulate(tx, flowId, request))
      })
    } catch (err) {
      if (!(err instanceof Rollback)) throw err
      result = err.result
    }
    await this.tenantDb.run((tx) =>
      this.audit.write(tx, {
        action: 'automation.tested',
        targetType: 'flow',
        targetId: flowId,
        changes: { matched: result!.matched, steps: result!.steps.length },
      }),
    )
    return result!
  }

  private async simulate(
    tx: TenantTx,
    flowId: string,
    request: FlowTestRequest,
  ): Promise<FlowTestResult> {
    const flow = await tx.flow.findFirst({ where: { id: flowId, deletedAt: null } })
    if (!flow) throw AppError.notFound('Automation not found.')
    const versionId = flow.draftVersionId ?? flow.activeVersionId
    const version = versionId ? await tx.flowVersion.findFirst({ where: { id: versionId } }) : null
    if (!version) throw AppError.notFound('This flow has no versions.')
    const validation = validateFlowGraph(version.graph)
    if (!validation.valid)
      throw new AppError(
        'FLOW_INVALID',
        422,
        'Fix the problems in this automation before testing it.',
        { errors: validation.errors },
      )
    const graph = flowGraphSchema.parse(version.graph)
    const trigger = triggerNodeOf(graph)!
    const now = new Date()

    const contactId = await this.sampleContact(tx, request)
    const event = this.triggerEvent(trigger, request)
    if ('reason' in event)
      return { matched: false, reason: event.reason, steps: [], truncated: false }

    const e = {
      id: randomUUID(),
      tenantId: currentTenant().tenantId,
      flowId,
      flowVersionId: version.id,
      triggerRunId: null,
      contactId,
      conversationId: null,
      triggerEvent: event.event as Prisma.JsonValue,
      status: 'RUNNING',
      currentNodeId: trigger.id,
      waitUntil: null,
      context: { vars: {} },
      stepCount: 0,
      errorCode: null,
      errorDetail: null,
      startedAt: now,
      finishedAt: null,
      updatedAt: now,
    } satisfies ExecutionRow

    const steps: FlowTestStep[] = []
    let clock = now
    let node: FlowNode | undefined = trigger
    while (node && steps.length < MAX_TEST_STEPS) {
      const ctx = (await loadContext(tx, e))!
      const simulated = isExternal(node) || node.type === 'action.assign_agent'
      const outcome = simulated
        ? await this.render(tx, node, ctx)
        : await runInternal(tx, e, node, ctx, clock)
      if (outcome.waitUntil) clock = outcome.waitUntil
      steps.push({
        nodeId: node.id,
        nodeType: node.type,
        mode: simulated || node.type === 'action.delay' ? 'SIMULATED' : 'RAN',
        status: outcome.status === 'FAILED' ? 'FAILED' : 'SUCCEEDED',
        handle: outcome.handle ?? null,
        summary:
          outcome.status === 'FAILED'
            ? (outcome.errorDetail ?? 'This step failed.')
            : await this.describe(tx, node, outcome, ctx, event.label),
        errorCode: outcome.errorCode ?? null,
      })
      if (outcome.terminal || !outcome.handle) break
      const next = edgeFrom(graph, node.id, outcome.handle)
      node = next ? graph.nodes.find((n) => n.id === next.target) : undefined
    }
    return {
      matched: true,
      reason: null,
      steps,
      truncated: !!node && steps.length >= MAX_TEST_STEPS,
    }
  }

  /** An existing contact, or a made-up one created inside the rolled-back transaction. */
  private async sampleContact(tx: TenantTx, request: FlowTestRequest): Promise<string> {
    if (request.contactId) {
      const c = await tx.contact.findFirst({ where: { id: request.contactId, deletedAt: null } })
      if (!c) throw AppError.notFound('Contact not found.')
      return c.id
    }
    const sample = request.contact ?? {}
    const { tenantId } = currentTenant()
    let phone: string | null = null
    if (sample.phone) {
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { defaultCountry: true },
      })
      const parsed = normalizePhone(sample.phone, tenant.defaultCountry)
      if (!parsed.ok)
        throw AppError.validation([
          { path: 'contact.phone', code: 'invalid', message: parsed.reason },
        ])
      phone = parsed.e164
    }
    if (phone && (await tx.contact.findFirst({ where: { phoneE164: phone, deletedAt: null } })))
      throw AppError.validation([
        {
          path: 'contact.phone',
          code: 'invalid',
          message: 'A contact with this number exists. Choose them from your contacts instead.',
        },
      ])
    while (!phone) {
      const candidate = `+1555${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`
      if (!(await tx.contact.findFirst({ where: { phoneE164: candidate } }))) phone = candidate
    }
    const contact = await tx.contact.create({
      data: { tenantId, phoneE164: phone, name: sample.name || 'Test contact', source: 'MANUAL' },
    })
    for (const [key, raw] of Object.entries(sample.properties ?? {})) {
      const def = await tx.contactPropertyDefinition.findFirst({ where: { key, archivedAt: null } })
      if (!def)
        throw AppError.validation([
          {
            path: `contact.properties.${key}`,
            code: 'invalid',
            message: `The contact field "${key}" does not exist.`,
          },
        ])
      const coerced = coercePropertyValue(def, raw)
      if ('error' in coerced)
        throw AppError.validation([
          { path: `contact.properties.${key}`, code: 'invalid', message: coerced.error },
        ])
      if (coerced.value)
        await tx.contactPropertyValue.create({
          data: { tenantId, contactId: contact.id, definitionId: def.id, ...coerced.value },
        })
    }
    const tagIds = [...new Set(sample.tagIds ?? [])]
    if (tagIds.length) {
      const tags = await tx.tag.findMany({ where: { id: { in: tagIds } }, select: { id: true } })
      await tx.contactTag.createMany({
        data: tags.map((t) => ({ tenantId, contactId: contact.id, tagId: t.id })),
      })
    }
    return contact.id
  }

  /** The trigger event the sample stands for, or why it would not start this automation. */
  private triggerEvent(
    trigger: FlowNode,
    request: FlowTestRequest,
  ): { event: Record<string, unknown>; label: string } | { reason: string } {
    const eventId = randomUUID()
    const text = request.message?.trim() ?? ''
    const message = { id: randomUUID(), type: 'TEXT', text }
    switch (trigger.type) {
      case 'trigger.keyword':
        if (!text) return { reason: 'Enter a sample message to test a keyword trigger.' }
        if (!keywordMatches(trigger.config, text))
          return {
            reason: `${quote(text)} doesn’t match this automation’s keywords, so it wouldn’t start.`,
          }
        return {
          event: { type: trigger.type, eventId, message },
          label: `Message ${quote(text)} matched a keyword`,
        }
      case 'trigger.message_received':
        if (!text) return { reason: 'Enter a sample message to test a Message received trigger.' }
        return {
          event: { type: trigger.type, eventId, message },
          label: `Message ${quote(text)} received`,
        }
      case 'trigger.contact_created':
        return {
          event: { type: trigger.type, eventId, contact: { source: 'MANUAL' } },
          label: 'The contact was added',
        }
      case 'trigger.webhook': {
        const body = request.webhook ?? {}
        const phone = getPath(body, trigger.config.contactPhonePath)
        if (phone === undefined || phone === null || phone === '')
          return {
            reason: `The sample payload has no phone number at “${trigger.config.contactPhonePath}”, so the call would be rejected.`,
          }
        return {
          event: { type: trigger.type, eventId, webhook: body },
          label: 'Your system called the webhook',
        }
      }
      default:
        return { reason: 'This automation has no trigger.' }
    }
  }

  /** Renders what an external step would do. Nothing leaves this method. */
  private async render(tx: TenantTx, node: FlowNode, ctx: Context): Promise<Outcome> {
    const ev = (t: string) => evaluateExpression(t, ctx)
    switch (node.type) {
      case 'action.send_message': {
        if (node.config.mediaFileId) {
          const caption = node.config.caption
            ? ` with the caption ${quote(ev(node.config.caption))}`
            : ''
          return {
            status: 'SUCCEEDED',
            handle: 'next',
            output: { text: `Would send a file${caption}.` },
          }
        }
        const text = ev(node.config.text ?? '').trim()
        if (!text)
          return {
            status: 'FAILED',
            handle: 'error',
            errorCode: 'MESSAGE_EMPTY',
            errorDetail: 'The message is empty after filling in values.',
          }
        return {
          status: 'SUCCEEDED',
          handle: 'next',
          output: { text: `Would send: ${quote(text, 600)}` },
        }
      }
      case 'action.send_template': {
        const template = await tx.template.findFirst({
          where: { id: node.config.templateId, deletedAt: null },
        })
        if (!template)
          return {
            status: 'FAILED',
            handle: 'error',
            errorCode: 'FLOW_REFERENCE_MISSING',
            errorDetail: 'The template used by this step was deleted.',
          }
        const approved = template.approvedVersionId
          ? await tx.templateVersion.findFirst({ where: { id: template.approvedVersionId } })
          : null
        if (!approved)
          return {
            status: 'FAILED',
            handle: 'error',
            errorCode: 'TEMPLATE_NOT_APPROVED',
            errorDetail: 'The template has no approved version.',
          }
        const body = (approved.components as { body?: { text?: string } }).body?.text ?? ''
        const rendered = renderTemplateText(body, node.config.variables.body.map(ev))
        return {
          status: 'SUCCEEDED',
          handle: 'next',
          output: { text: `Would send the template “${template.name}”: ${quote(rendered, 600)}` },
        }
      }
      case 'action.webhook':
        return {
          status: 'SUCCEEDED',
          handle: 'next',
          output: {
            text: `Would call ${node.config.method} ${ev(node.config.url).trim()} (not called in a test).`,
          },
        }
      case 'action.ai_reply':
        return {
          status: 'SUCCEEDED',
          handle: 'replied',
          output: { text: 'Would answer with the AI Assistant (AI is not called in a test).' },
        }
      case 'action.assign_agent':
        return {
          status: 'SUCCEEDED',
          handle: 'next',
          output: {
            text:
              node.config.mode === 'ROUND_ROBIN'
                ? 'Would assign the conversation to whoever is online (round robin).'
                : 'Would assign the conversation to the chosen teammate.',
          },
        }
      default:
        throw new Error(`${node.type} is not rendered`)
    }
  }

  /** One plain-language line per step; conditions say why they went Yes or No. */
  private async describe(
    tx: TenantTx,
    node: FlowNode,
    o: Outcome,
    ctx: Context,
    started: string,
  ): Promise<string> {
    const yes = o.handle === 'yes'
    const verdict = yes ? 'Yes' : 'No'
    const input = (o.input ?? {}) as Record<string, unknown>
    switch (node.type) {
      case 'trigger.keyword':
      case 'trigger.message_received':
      case 'trigger.contact_created':
      case 'trigger.webhook':
        return `Started: ${started}.`
      case 'condition.equals':
        return `${verdict}: ${quote(String(input.subject))} ${yes ? 'equals' : 'does not equal'} ${quote(String(input.value))}.`
      case 'condition.contains':
        return `${verdict}: ${quote(String(input.subject))} ${yes ? 'contains' : 'does not contain'} ${quote(String(input.value))}.`
      case 'condition.exists':
        return yes
          ? `Yes: the value is set (${quote(String(input.subject))}).`
          : 'No: the value is empty.'
      case 'condition.has_tag': {
        const names = await this.tagNames(tx, node.config.tagIds)
        const all = node.config.match === 'ALL'
        return yes
          ? `Yes: the contact has ${all ? 'all of' : 'the tag'} ${names}.`
          : `No: the contact doesn’t have ${all ? 'all of' : 'any of'} ${names}.`
      }
      case 'condition.contact_property': {
        const field =
          node.config.key === 'lastInboundAt' ? 'Last message from the contact' : node.config.key
        const op = node.config.operator.toLowerCase().replaceAll('_', ' ')
        const value = node.config.value === undefined ? '' : ` ${JSON.stringify(node.config.value)}`
        return `${verdict}: ${field} ${yes ? 'is' : 'is not'} ${op}${value}.`
      }
      case 'action.add_tag':
      case 'action.remove_tag':
        return `Would ${node.type === 'action.add_tag' ? 'add' : 'remove'} ${node.config.tagIds.length === 1 ? 'the tag' : 'the tags'} ${await this.tagNames(tx, node.config.tagIds)}.`
      case 'action.update_contact':
        return `Would update ${node.config.updates.map((u) => `${u.field.replace('property.', '')} to ${quote(evaluateExpression(u.value, ctx))}`).join(', ')}.`
      case 'action.delay':
        return `Would wait ${plural(node.config.amount, UNIT[node.config.unit])}, then continue (skipped in a test).`
      case 'action.end':
        return 'Finishes the automation.'
      default:
        return String((o.output as { text?: string } | undefined)?.text ?? 'Done.')
    }
  }

  private async tagNames(tx: TenantTx, ids: string[]) {
    const tags = await tx.tag.findMany({ where: { id: { in: ids } }, select: { name: true } })
    return tags.map((t) => t.name).join(', ') || 'the chosen tags'
  }
}

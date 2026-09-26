import { z } from 'zod'
import { OPERATORS } from '../contacts/filter'

/**
 * Automation flow graph and node catalog v1 (docs/AUTOMATION_ENGINE.md). The runtime executes
 * `nodes` + `edges` only; `layout` (canvas positions) is editor metadata the engine never reads.
 */

const id = z.uuid()
const expr = z.string().max(4096)

export const TRIGGER_TYPES = [
  'trigger.message_received',
  'trigger.keyword',
  'trigger.contact_created',
  'trigger.webhook',
] as const
export type TriggerType = (typeof TRIGGER_TYPES)[number]

export const nodeSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string(),
    type: z.literal('trigger.message_received'),
    config: z.object({
      phoneNumberIds: z.array(id).max(20).optional(),
      onlyNewConversation: z.boolean().default(false),
    }),
  }),
  z.object({
    id: z.string(),
    type: z.literal('trigger.keyword'),
    config: z.object({
      keywords: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
      match: z.enum(['EXACT', 'CONTAINS', 'STARTS_WITH']).default('EXACT'),
      caseSensitive: z.boolean().default(false),
    }),
  }),
  z.object({
    id: z.string(),
    type: z.literal('trigger.contact_created'),
    config: z.object({ sources: z.array(z.string()).max(10).optional() }),
  }),
  z.object({
    id: z.string(),
    type: z.literal('trigger.webhook'),
    config: z.object({
      /** Dotted path into the JSON body, e.g. `customer.phone`. */
      contactPhonePath: z.string().trim().min(1).max(200),
      requireSignature: z.boolean().default(true),
    }),
  }),
  z.object({
    id: z.string(),
    type: z.enum(['condition.equals', 'condition.contains']),
    config: z.object({
      subject: expr.min(1),
      value: expr,
      caseSensitive: z.boolean().default(false),
    }),
  }),
  z.object({
    id: z.string(),
    type: z.literal('condition.exists'),
    config: z.object({ subject: expr.min(1) }),
  }),
  z.object({
    id: z.string(),
    type: z.literal('condition.has_tag'),
    config: z.object({
      tagIds: z.array(id).min(1).max(20),
      match: z.enum(['ANY', 'ALL']).default('ANY'),
    }),
  }),
  z.object({
    id: z.string(),
    type: z.literal('condition.contact_property'),
    config: z.object({
      key: z.string().min(1).max(63),
      operator: z.enum(OPERATORS as unknown as [string, ...string[]]),
      value: z.unknown().optional(),
    }),
  }),
  z.object({
    id: z.string(),
    type: z.literal('action.send_message'),
    config: z
      .object({
        text: z.string().max(4096).optional(),
        mediaFileId: id.optional(),
        caption: z.string().max(1024).optional(),
      })
      .refine((c) => Boolean(c.text?.trim()) !== Boolean(c.mediaFileId), {
        message: 'Enter a message, or choose a file.',
      }),
  }),
  z.object({
    id: z.string(),
    type: z.literal('action.send_template'),
    config: z.object({
      templateId: id,
      variables: z.object({
        header: z.array(expr).max(1).optional(),
        body: z.array(expr).max(100).default([]),
        buttons: z.record(z.string(), z.array(expr).max(1)).optional(),
      }),
    }),
  }),
  z.object({
    id: z.string(),
    type: z.enum(['action.add_tag', 'action.remove_tag']),
    config: z.object({ tagIds: z.array(id).min(1).max(20) }),
  }),
  z.object({
    id: z.string(),
    type: z.literal('action.assign_agent'),
    config: z
      .object({ mode: z.enum(['USER', 'ROUND_ROBIN']), userId: id.optional() })
      .refine((c) => c.mode === 'ROUND_ROBIN' || Boolean(c.userId), {
        message: 'Choose a teammate.',
      }),
  }),
  z.object({
    id: z.string(),
    type: z.literal('action.update_contact'),
    config: z.object({
      updates: z
        .array(
          z.object({
            field: z.union([
              z.enum(['name', 'email', 'language']),
              z.string().regex(/^property\.[a-z][a-z0-9_]{0,62}$/),
            ]),
            value: expr,
          }),
        )
        .min(1)
        .max(20),
    }),
  }),
  z.object({
    id: z.string(),
    type: z.literal('action.webhook'),
    config: z.object({
      method: z.enum(['POST', 'GET']).default('POST'),
      url: z.string().trim().min(8).max(2000),
      headers: z.record(z.string().max(100), z.string().max(2000)).optional(),
      body: expr.optional(),
      timeoutMs: z.number().int().min(500).max(10_000).default(5000),
      saveResponseAs: z
        .string()
        .regex(/^[a-z][a-z0-9_]{0,39}$/)
        .optional(),
    }),
  }),
  z.object({
    id: z.string(),
    type: z.literal('action.delay'),
    config: z.object({
      amount: z.number().int().min(1).max(43_200),
      unit: z.enum(['MINUTES', 'HOURS', 'DAYS']),
    }),
  }),
  z.object({ id: z.string(), type: z.literal('action.end'), config: z.object({}).default({}) }),
])
export type FlowNode = z.infer<typeof nodeSchema>
export type NodeType = FlowNode['type']
export const NODE_TYPES = nodeSchema.options.flatMap((o) =>
  'options' in o.shape.type
    ? (o.shape.type.options as NodeType[])
    : [o.shape.type.value as NodeType],
)

export const EDGE_HANDLES = ['next', 'yes', 'no', 'error'] as const
export type EdgeHandle = (typeof EDGE_HANDLES)[number]
export const edgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.enum(EDGE_HANDLES).default('next'),
})
export type FlowEdge = z.infer<typeof edgeSchema>

export const flowGraphSchema = z.object({
  nodes: z.array(nodeSchema).max(200),
  edges: z.array(edgeSchema).max(400),
  /** Editor-only: canvas positions by node id. Never read by the runtime. */
  layout: z.record(z.string(), z.object({ x: z.number(), y: z.number() })).default({}),
})
export type FlowGraph = z.infer<typeof flowGraphSchema>

/**
 * What the builder saves: node configs may be incomplete while editing. Publishing (and the
 * runtime) parse the strict `flowGraphSchema`; `validateFlowGraph` pinpoints what's missing.
 */
export const draftGraphSchema = z.object({
  nodes: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        type: z.enum(NODE_TYPES as [NodeType, ...NodeType[]]),
        config: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .max(200),
  edges: z.array(edgeSchema).max(400),
  layout: z.record(z.string(), z.object({ x: z.number(), y: z.number() })).default({}),
})
export type DraftGraph = z.infer<typeof draftGraphSchema>

export const isTrigger = (t: NodeType) => t.startsWith('trigger.')
export const isCondition = (t: NodeType) => t.startsWith('condition.')
/** Outputs each node type offers (the builder's handles). */
export function outputsOf(t: NodeType): EdgeHandle[] {
  if (isTrigger(t)) return ['next']
  if (isCondition(t)) return ['yes', 'no']
  if (t === 'action.end') return []
  if (
    t === 'action.send_message' ||
    t === 'action.send_template' ||
    t === 'action.update_contact' ||
    t === 'action.webhook' ||
    t === 'action.assign_agent'
  )
    return ['next', 'error']
  return ['next']
}

export const MAX_FLOW_NODES = 100
/** Runtime safety limit (P10 plan §8): executions stop with FLOW_STEP_LIMIT. */
export const MAX_EXECUTION_STEPS = 500

import {
  type AiActivationRequest,
  type AiPlan,
  type CreateAiActivationRequest,
} from '@fenwira/contracts'
import { AppError } from '../../core/http/app-error'

/** Submissions per workspace per hour (docs/AI_ASSISTANT.md → Activation requests). */
export const AI_ACTIVATION_LIMITS = { perWorkspacePerHour: 5, perUserPerHour: 5 }

type PlanRow = {
  id: string
  name: string
  monthlyPriceMinor: bigint
  currency: string
  includedReplies: number
  description: string | null
  active: boolean
  sortOrder: number
}

export const toAiPlan = (p: PlanRow): AiPlan => ({
  id: p.id,
  name: p.name,
  monthlyPriceMinor: Number(p.monthlyPriceMinor),
  currency: p.currency,
  includedReplies: p.includedReplies,
  description: p.description,
  active: p.active,
  sortOrder: p.sortOrder,
})

type RequestRow = {
  id: string
  status: AiActivationRequest['status']
  planId: string | null
  expectedConversations: number
  useCase: string
  contactEmail: string
  contactPhone: string | null
  decisionNote: string | null
  decidedAt: Date | null
  createdAt: Date
  plan?: { name: string } | null
}

export const toAiActivationRequest = (r: RequestRow): AiActivationRequest => ({
  id: r.id,
  status: r.status,
  planId: r.planId,
  planName: r.plan?.name ?? null,
  expectedConversations: r.expectedConversations,
  useCase: r.useCase,
  contactEmail: r.contactEmail,
  contactPhone: r.contactPhone,
  decisionNote: r.decisionNote,
  decidedAt: r.decidedAt?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
})

/**
 * Server-side rules for a new request, given the workspace state. Pure, so the rules are unit
 * tested; the partial unique index is the race-proof backstop for the open-request rule.
 */
export function assertCanRequest(
  input: Pick<CreateAiActivationRequest, 'planId'>,
  state: { enabled: boolean; openRequest: boolean; activePlanIds: readonly string[] },
): void {
  if (state.enabled)
    throw new AppError('AI_ALREADY_ENABLED', 409, 'AI Assistant is already on for this workspace.')
  if (state.openRequest)
    throw new AppError(
      'AI_REQUEST_OPEN',
      409,
      'This workspace already has an activation request in review.',
    )
  if (
    input.planId === null
      ? state.activePlanIds.length > 0
      : !state.activePlanIds.includes(input.planId)
  )
    throw new AppError('AI_PLAN_UNAVAILABLE', 400, 'Choose one of the available plans.')
}

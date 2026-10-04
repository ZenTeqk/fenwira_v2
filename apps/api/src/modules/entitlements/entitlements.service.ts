import { type TenantTx } from '@fenwira/database'
import {
  type CapabilityKey,
  type EntitlementKey as ContractEntitlementKey,
  type LimitKey as ContractLimitKey,
} from '@fenwira/contracts'
import { Inject, Injectable, Optional } from '@nestjs/common'
import { AppError } from '../../core/http/app-error'
import { SUBSCRIPTION_ACTIVE } from './subscription-entitlement.source'

/**
 * Entitlement keys (decision P10-D3; catalog in @fenwira/contracts → subscriptions). Code asks about
 * capabilities and limits, never about plan names; which plan grants what is data owned by the
 * source (Phase 11 Step 4: SubscriptionEntitlementSource).
 */
export type EntitlementKey = ContractEntitlementKey
type FeatureKey = CapabilityKey | typeof SUBSCRIPTION_ACTIVE
type LimitKey = ContractLimitKey

/** Where entitlements come from. A limit of `null` means unlimited. */
export interface EntitlementSource {
  enabled(tx: TenantTx, tenantId: string, key: FeatureKey): Promise<boolean>
  limit(tx: TenantTx, tenantId: string, key: LimitKey): Promise<number | null>
}

/** Phase 10 source: everything enabled, nothing limited. */
export const ALLOW_ALL_ENTITLEMENTS: EntitlementSource = {
  enabled: async () => true,
  limit: async () => null,
}

export const ENTITLEMENT_SOURCE = Symbol('ENTITLEMENT_SOURCE')

export type EntitlementDecision =
  { allowed: true } | { allowed: false; key: EntitlementKey; limit?: number; message: string }

/** The single entitlement boundary. Checks run inside the caller's tenant transaction. */
@Injectable()
export class EntitlementsService {
  private source: EntitlementSource

  constructor(@Optional() @Inject(ENTITLEMENT_SOURCE) source?: EntitlementSource) {
    this.source = source ?? ALLOW_ALL_ENTITLEMENTS
  }

  /** Replaces the source (Phase 11 wires plan data; tests use it to simulate limits). */
  useSource(source: EntitlementSource): void {
    this.source = source
  }

  /** Whether a capability is on (unset ⇒ on). */
  isEnabled(tx: TenantTx, tenantId: string, key: FeatureKey): Promise<boolean> {
    return this.source.enabled(tx, tenantId, key)
  }

  /** A numeric limit (null ⇒ unlimited). */
  getLimit(tx: TenantTx, tenantId: string, key: LimitKey): Promise<number | null> {
    return this.source.limit(tx, tenantId, key)
  }

  /**
   * Current usage of a quantitative limit (docs/BILLING.md → Limits). `null` for limits that are
   * enforced elsewhere by their own counters (executions per month, retention days).
   */
  async usage(tx: TenantTx, key: LimitKey): Promise<number | null> {
    switch (key) {
      case 'max_users': {
        const [members, invites] = await Promise.all([
          tx.membership.count({ where: { status: 'ACTIVE' } }),
          tx.invitation.count({
            where: {
              status: 'PENDING',
              OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            },
          }),
        ])
        return members + invites
      }
      case 'max_contacts':
        return tx.contact.count({ where: { deletedAt: null } })
      case 'max_active_flows':
        return tx.flow.count({ where: { status: 'ACTIVE', deletedAt: null } })
      default:
        return null
    }
  }

  /**
   * Refuses user-initiated growth past a limit with 422 LIMIT_EXCEEDED {key, limit, current}.
   * Takes a transaction-scoped advisory lock per tenant and key first, so concurrent creates at
   * `limit - 1` serialize and exactly one wins. Inbound paths never call this (P11-D16): a
   * customer writing in is never refused or dropped to enforce a commercial limit.
   */
  async assertWithin(tx: TenantTx, tenantId: string, key: LimitKey, increment = 1): Promise<void> {
    const limit = await this.source.limit(tx, tenantId, key)
    if (limit === null) return
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${tenantId}:${key}`}))`
    const current = (await this.usage(tx, key)) ?? 0
    if (current + increment > limit)
      throw new AppError('LIMIT_EXCEEDED', 422, limitMessage(key, limit), {
        key,
        limit,
        current,
      })
  }

  /** TRIALING (unexpired) or ACTIVE (P11-D6). Expired workspaces keep operating, but don't grow. */
  subscriptionActive(tx: TenantTx, tenantId: string): Promise<boolean> {
    return this.source.enabled(tx, tenantId, SUBSCRIPTION_ACTIVE)
  }

  async canPublishFlow(
    tx: TenantTx,
    tenantId: string,
    alreadyActive: boolean,
  ): Promise<EntitlementDecision> {
    if (!alreadyActive && !(await this.subscriptionActive(tx, tenantId)))
      return {
        allowed: false,
        key: 'automation_enabled',
        message:
          'This workspace’s trial or subscription has ended. Choose a plan to publish automations.',
      }
    if (!(await this.source.enabled(tx, tenantId, 'automation_enabled')))
      return {
        allowed: false,
        key: 'automation_enabled',
        message: "Automations aren't included in this workspace's plan.",
      }
    if (alreadyActive) return { allowed: true }
    const max = await this.source.limit(tx, tenantId, 'max_active_flows')
    if (max === null) return { allowed: true }
    // Same per-tenant lock as assertWithin: two concurrent publishes can't both take the last slot.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${tenantId}:max_active_flows`}))`
    const active = await tx.flow.count({ where: { status: 'ACTIVE', deletedAt: null } })
    return active < max
      ? { allowed: true }
      : {
          allowed: false,
          key: 'max_active_flows',
          limit: max,
          message: `This workspace can have ${max} active automations. Pause one to publish another.`,
        }
  }

  /**
   * Days of analytics history this workspace keeps (P11-D15); null = unlimited. Only analytics
   * projections are affected: ledger, audit and operational records have their own retention.
   */
  analyticsRetentionDays(tx: TenantTx, tenantId: string): Promise<number | null> {
    return this.source.limit(tx, tenantId, 'analytics_retention')
  }

  /** P11-D18: whether this workspace's plan includes the public API. Unset source ⇒ enabled. */
  apiEnabled(tx: TenantTx, tenantId: string): Promise<boolean> {
    return this.source.enabled(tx, tenantId, 'api_enabled')
  }

  /** P11-D18: whether this workspace's plan includes outbound webhooks. */
  webhooksEnabled(tx: TenantTx, tenantId: string): Promise<boolean> {
    return this.source.enabled(tx, tenantId, 'webhooks_enabled')
  }

  async canStartExecution(tx: TenantTx, tenantId: string, now: Date): Promise<EntitlementDecision> {
    if (!(await this.source.enabled(tx, tenantId, 'automation_enabled')))
      return { allowed: false, key: 'automation_enabled', message: 'Automations are not enabled.' }
    const max = await this.source.limit(tx, tenantId, 'automation_execution_limit')
    if (max === null) return { allowed: true }
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const started = await tx.automationExecution.count({
      where: { startedAt: { gte: monthStart } },
    })
    return started < max
      ? { allowed: true }
      : {
          allowed: false,
          key: 'automation_execution_limit',
          limit: max,
          message: `The monthly automation limit (${max}) is reached.`,
        }
  }
}

function limitMessage(key: LimitKey, limit: number): string {
  const n = limit.toLocaleString('en-IN')
  switch (key) {
    case 'max_users':
      return `Your plan allows ${n} team members. Remove someone or change plan to add more.`
    case 'max_contacts':
      return `Your plan allows ${n} contacts. Delete contacts or change plan to add more.`
    case 'max_active_flows':
      return `Your plan allows ${n} active automations. Pause one or change plan to publish another.`
    default:
      return `Your plan's limit (${n}) is reached.`
  }
}

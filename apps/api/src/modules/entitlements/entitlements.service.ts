import { type TenantTx } from '@fenwira/database'
import { Inject, Injectable, Optional } from '@nestjs/common'

/**
 * Entitlement keys (decision P10-D3). Code asks about capabilities and limits, never about plan
 * names; which plan grants what is data owned by the source (Phase 11 plugs in plan data).
 */
export type EntitlementKey =
  | 'automation_enabled'
  | 'max_active_flows'
  /** Automation executions a tenant may start per calendar month (UTC). */
  | 'automation_execution_limit'
  /** P11-D15: days of product-analytics history kept (plan data: 30 / 90 / 365). */
  | 'analytics_retention'
  /** P11-D18: the public API surface is reachable at all (plan data: GROWTH/BUSINESS). */
  | 'api_enabled'
  /** P11-D18: outbound webhooks may be configured (plan data: GROWTH/BUSINESS). */
  | 'webhooks_enabled'

type FeatureKey = Extract<EntitlementKey, 'automation_enabled' | 'api_enabled' | 'webhooks_enabled'>
type LimitKey = Exclude<EntitlementKey, FeatureKey>

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

  async canPublishFlow(
    tx: TenantTx,
    tenantId: string,
    alreadyActive: boolean,
  ): Promise<EntitlementDecision> {
    if (!(await this.source.enabled(tx, tenantId, 'automation_enabled')))
      return {
        allowed: false,
        key: 'automation_enabled',
        message: "Automations aren't included in this workspace's plan.",
      }
    if (alreadyActive) return { allowed: true }
    const max = await this.source.limit(tx, tenantId, 'max_active_flows')
    if (max === null) return { allowed: true }
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

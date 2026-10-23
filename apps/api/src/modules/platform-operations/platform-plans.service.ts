import { type PlatformPlan, type SetPlanPrice } from '@fenwira/contracts'
import { Database } from '@fenwira/database'
import { Inject, Injectable } from '@nestjs/common'
import { requestContext } from '../../core/context/request-context'
import { AppError } from '../../core/http/app-error'

/** Plan prices for automatic renewal invoices (docs/BILLING.md → Manual invoices). */
@Injectable()
export class PlatformPlansService {
  constructor(@Inject(Database) private readonly db: Database) {}

  private operator(): string {
    const id = requestContext.get()?.platform?.operatorId
    if (!id) throw new AppError('FORBIDDEN', 403, 'Operator session required.')
    return id
  }

  async list(): Promise<PlatformPlan[]> {
    this.operator()
    const plans = await this.db.withGlobal((tx) =>
      tx.plan.findMany({
        orderBy: { sort: 'asc' },
        include: { prices: { where: { active: true, interval: 'MONTH', currency: 'INR' } } },
      }),
    )
    return plans.map((p) => ({
      key: p.key,
      name: p.name,
      monthly: p.prices[0]
        ? { currency: p.prices[0].currency, amountMinor: Number(p.prices[0].amountMinor) }
        : null,
    }))
  }

  /** Applies to invoices issued from now on; issued invoices keep their snapshot amount. */
  async setPrice(planKey: string, input: SetPlanPrice): Promise<PlatformPlan> {
    const operatorId = this.operator()
    const known = await this.db.withGlobal((tx) => tx.plan.findUnique({ where: { key: planKey } }))
    if (!known) throw AppError.notFound()
    await this.db.system.platformSetPlanPrice(
      operatorId,
      planKey,
      input.currency,
      input.amountMinor,
    )
    await this.db.withGlobal((tx) =>
      tx.platformAudit.createMany({
        data: {
          operatorId,
          action: 'platform.plan_price_set',
          outcome: 'SUCCESS',
          correlationId: requestContext.correlationId() ?? null,
          details: { planKey, currency: input.currency, amountMinor: input.amountMinor },
        },
      }),
    )
    return (await this.list()).find((p) => p.key === planKey)!
  }
}

import { type SalesOutcome, type SalesStage } from '@fenwira/contracts'
import { Prisma, type TenantTx } from '@fenwira/database'
import { Injectable } from '@nestjs/common'
import { TenantDb } from '../../core/database/tenant-db'
import { AppError } from '../../core/http/app-error'
import { AuditService } from '../audit'
import { currentTenant } from '../tenancy'
import { assertSalesEnabled, ensureStages } from './sales.core'

const MAX_ACTIVE = 20

/**
 * Settings → Sales → Stages (docs/FOLLOW_UPS_AND_SALES.md → Stages). Stable ids and outcome
 * types; a stage is archived, never deleted, so opportunities keep their history. Each outcome
 * (open, won, lost) always keeps at least one active stage.
 */
@Injectable()
export class SalesStagesService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<SalesStage[]> {
    const { tenantId } = currentTenant()
    return this.db.run(async (tx) => this.dto(tx, await ensureStages(tx, tenantId)))
  }

  async create(input: { name: string; outcome: SalesOutcome }): Promise<SalesStage[]> {
    const { tenantId } = currentTenant()
    return this.db.run(async (tx) => {
      await assertSalesEnabled(tx, tenantId)
      await this.lock(tx, tenantId)
      const stages = await ensureStages(tx, tenantId)
      const active = stages.filter((s) => !s.archivedAt)
      if (active.length >= MAX_ACTIVE)
        throw new AppError(
          'LIMIT_EXCEEDED',
          422,
          `A workspace can have up to ${MAX_ACTIVE} stages.`,
        )
      this.assertUniqueName(active, input.name)
      // New open stages go after the last open stage; won/lost go to the end.
      const lastOpen = active.filter((s) => s.outcome === 'OPEN').at(-1)
      const position =
        input.outcome === 'OPEN' && lastOpen ? lastOpen.position + 1 : stages.length + 1
      if (input.outcome === 'OPEN' && lastOpen)
        await tx.salesStage.updateMany({
          where: { position: { gte: position } },
          data: { position: { increment: 1 } },
        })
      const stage = await tx.salesStage.create({
        data: { tenantId, name: input.name, outcome: input.outcome, position },
      })
      await this.audit.write(tx, {
        action: 'sales.stage_created',
        targetType: 'sales_stage',
        targetId: stage.id,
        changes: { name: input.name, outcome: input.outcome },
      })
      return this.dto(tx, await ensureStages(tx, tenantId))
    })
  }

  async update(id: string, input: { name?: string; archived?: boolean }): Promise<SalesStage[]> {
    const { tenantId } = currentTenant()
    return this.db.run(async (tx) => {
      await assertSalesEnabled(tx, tenantId)
      await this.lock(tx, tenantId)
      const stages = await ensureStages(tx, tenantId)
      const stage = stages.find((s) => s.id === id)
      if (!stage) throw AppError.notFound('Stage not found.')
      const changes: Record<string, unknown> = {}
      const data: Prisma.SalesStageUpdateInput = {}
      if (input.name !== undefined && input.name !== stage.name) {
        this.assertUniqueName(
          stages.filter((s) => !s.archivedAt && s.id !== id),
          input.name,
        )
        data.name = input.name
        changes.name = [stage.name, input.name]
      }
      if (input.archived !== undefined && input.archived !== Boolean(stage.archivedAt)) {
        if (input.archived) {
          const sameOutcome = stages.filter(
            (s) => !s.archivedAt && s.outcome === stage.outcome && s.id !== id,
          )
          if (!sameOutcome.length)
            throw new AppError(
              'UNPROCESSABLE',
              422,
              'Keep at least one active stage for each outcome (open, won and lost).',
            )
          // Open opportunities can't sit in an archived stage: move them first.
          const open = await tx.opportunity.count({ where: { stageId: id, status: 'OPEN' } })
          if (open)
            throw new AppError(
              'UNPROCESSABLE',
              422,
              `${open} open ${open === 1 ? 'opportunity is' : 'opportunities are'} in this stage. Move ${open === 1 ? 'it' : 'them'} to another stage first.`,
              { openOpportunities: open },
            )
        } else {
          if (stages.filter((s) => !s.archivedAt).length >= MAX_ACTIVE)
            throw new AppError(
              'LIMIT_EXCEEDED',
              422,
              `A workspace can have up to ${MAX_ACTIVE} stages.`,
            )
          this.assertUniqueName(
            stages.filter((s) => !s.archivedAt),
            (data.name as string | undefined) ?? stage.name,
          )
        }
        data.archivedAt = input.archived ? new Date() : null
        changes.archived = [Boolean(stage.archivedAt), input.archived]
      }
      if (Object.keys(changes).length) {
        await tx.salesStage.update({ where: { id }, data })
        await this.audit.write(tx, {
          action: input.archived === undefined ? 'sales.stage_updated' : 'sales.stage_archived',
          targetType: 'sales_stage',
          targetId: id,
          changes,
        })
      }
      return this.dto(tx, await ensureStages(tx, tenantId))
    })
  }

  /** `ids` is the full new order of the active stages. Archived stages keep their positions after. */
  async reorder(ids: string[]): Promise<SalesStage[]> {
    const { tenantId } = currentTenant()
    return this.db.run(async (tx) => {
      await assertSalesEnabled(tx, tenantId)
      await this.lock(tx, tenantId)
      const stages = await ensureStages(tx, tenantId)
      const active = stages.filter((s) => !s.archivedAt)
      const same =
        ids.length === active.length &&
        new Set(ids).size === ids.length &&
        ids.every((id) => active.some((s) => s.id === id))
      if (!same)
        throw AppError.validation([
          {
            path: 'ids',
            code: 'stale_order',
            message: 'The stage list changed. Refresh and try again.',
          },
        ])
      const archived = stages.filter((s) => s.archivedAt)
      const order = [...ids, ...archived.map((s) => s.id)]
      for (const [position, id] of order.entries())
        await tx.salesStage.update({ where: { id }, data: { position } })
      await this.audit.write(tx, {
        action: 'sales.stages_reordered',
        targetType: 'sales_stage',
        changes: { order: ids },
      })
      return this.dto(tx, await ensureStages(tx, tenantId))
    })
  }

  /** Serializes stage edits per workspace (positions and the per-outcome rule). */
  private async lock(tx: TenantTx, tenantId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sales_stages:${tenantId}`}))`
  }

  private assertUniqueName(active: Array<{ name: string }>, name: string) {
    if (active.some((s) => s.name.toLowerCase() === name.trim().toLowerCase()))
      throw AppError.validation([
        { path: 'name', code: 'taken', message: 'Another active stage already has this name.' },
      ])
  }

  private async dto(
    tx: TenantTx,
    stages: Array<{
      id: string
      name: string
      outcome: SalesOutcome
      position: number
      archivedAt: Date | null
    }>,
  ): Promise<SalesStage[]> {
    const counts = await tx.opportunity.groupBy({
      by: ['stageId'],
      _count: { _all: true },
    })
    const byStage = new Map(counts.map((c) => [c.stageId, c._count._all]))
    return stages.map((s) => ({
      id: s.id,
      name: s.name,
      outcome: s.outcome,
      position: s.position,
      archived: Boolean(s.archivedAt),
      opportunityCount: byStage.get(s.id) ?? 0,
    }))
  }
}

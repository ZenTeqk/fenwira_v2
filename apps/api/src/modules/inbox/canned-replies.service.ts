import { type CannedReply, type CreateCannedReply } from '@fenwira/contracts'
import { Prisma, type TenantTx } from '@fenwira/database'
import { Injectable } from '@nestjs/common'
import { TenantDb } from '../../core/database/tenant-db'
import { AppError } from '../../core/http/app-error'
import { AuditService } from '../audit'
import { currentAuth } from '../identity'
import { currentTenant } from '../tenancy'

type Row = Prisma.CannedReplyGetPayload<object>

export const toCannedReply = (r: Row): CannedReply => ({
  id: r.id,
  shortcut: r.shortcut,
  title: r.title,
  body: r.body,
  createdBy: r.createdBy,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
})

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
const taken = (shortcut: string) =>
  new AppError('CONFLICT', 409, `The shortcut ${shortcut} is already used in this workspace.`, {
    field: 'shortcut',
  })

/**
 * Workspace-shared canned replies (docs/INBOX.md → Canned replies, decisions I2/I3). Tenant-bound
 * through RLS; the composer only inserts them, so sending still goes through the reply path.
 */
@Injectable()
export class CannedRepliesService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
  ) {}

  list(q?: string): Promise<CannedReply[]> {
    return this.tenantDb.run(async (tx) => {
      const rows = await tx.cannedReply.findMany({
        where: q
          ? {
              OR: [
                { shortcut: { contains: q, mode: 'insensitive' } },
                { title: { contains: q, mode: 'insensitive' } },
              ],
            }
          : undefined,
        orderBy: { shortcut: 'asc' },
        take: 500,
      })
      return rows.map(toCannedReply)
    })
  }

  async create(input: CreateCannedReply): Promise<CannedReply> {
    const { userId } = currentAuth()
    const { tenantId } = currentTenant()
    // A unique violation aborts the transaction, so check first; the catch covers a race.
    try {
      return await this.tenantDb.run(async (tx) => {
        await this.assertFree(tx, input.shortcut)
        const row = await tx.cannedReply.create({ data: { ...input, tenantId, createdBy: userId } })
        await this.audit.write(tx, {
          action: 'canned_reply.created',
          targetType: 'canned_reply',
          targetId: row.id,
          changes: { shortcut: row.shortcut },
        })
        return toCannedReply(row)
      })
    } catch (err) {
      throw isUniqueViolation(err) ? taken(input.shortcut) : err
    }
  }

  async update(id: string, input: Partial<CreateCannedReply>): Promise<CannedReply> {
    try {
      return await this.tenantDb.run(async (tx) => {
        await this.find(tx, id)
        if (input.shortcut) await this.assertFree(tx, input.shortcut, id)
        const row = await tx.cannedReply.update({ where: { id }, data: input })
        await this.audit.write(tx, {
          action: 'canned_reply.updated',
          targetType: 'canned_reply',
          targetId: id,
          changes: { fields: Object.keys(input) },
        })
        return toCannedReply(row)
      })
    } catch (err) {
      throw isUniqueViolation(err) ? taken(input.shortcut ?? '') : err
    }
  }

  remove(id: string): Promise<void> {
    return this.tenantDb.run(async (tx) => {
      const row = await this.find(tx, id)
      await tx.cannedReply.delete({ where: { id } })
      await this.audit.write(tx, {
        action: 'canned_reply.deleted',
        targetType: 'canned_reply',
        targetId: id,
        changes: { shortcut: row.shortcut },
      })
    })
  }

  private async find(tx: TenantTx, id: string): Promise<Row> {
    const row = await tx.cannedReply.findFirst({ where: { id } })
    if (!row) throw new AppError('NOT_FOUND', 404, 'Canned reply not found.')
    return row
  }

  private async assertFree(tx: TenantTx, shortcut: string, exceptId?: string): Promise<void> {
    const existing = await tx.cannedReply.findFirst({
      where: { shortcut, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
      select: { id: true },
    })
    if (existing) throw taken(shortcut)
  }
}

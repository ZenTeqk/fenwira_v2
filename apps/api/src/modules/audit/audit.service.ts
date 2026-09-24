import { type AuditLog, type AuditQuery } from '@fenwira/contracts'
import { Prisma, type TenantTx } from '@fenwira/database'
import { Injectable } from '@nestjs/common'
import { requestContext } from '../../core/context/request-context'
import { afterCursor, decodeCursor, toPage } from '../../core/http/cursor'

export type AuditEntry = {
  action: string
  targetType: string
  targetId?: string | null
  changes?: Record<string, unknown>
  /** Defaults to the request's tenant; required when writing before the tenant guard runs. */
  tenantId?: string
  actorId?: string | null
}

/** Secrets never go into `changes` (docs/SECURITY.md → Audit). */
const REDACT = /(password|token|secret|code)/i
function redact(changes: Record<string, unknown> | undefined) {
  if (!changes) return undefined
  return Object.fromEntries(
    Object.entries(changes).map(([k, v]) => [k, REDACT.test(k) ? '[REDACTED]' : v]),
  )
}

/** Tenant audit trail. Always written inside the caller's transaction so it commits with the change. */
@Injectable()
export class AuditService {
  async write(tx: TenantTx, entry: AuditEntry): Promise<void> {
    const ctx = requestContext.get()
    const tenantId = entry.tenantId ?? ctx?.tenant?.tenantId
    if (!tenantId) throw new Error('Audit entry without tenant context')
    const actorId = entry.actorId === undefined ? (ctx?.auth?.userId ?? null) : entry.actorId
    await tx.auditLog.create({
      data: {
        tenantId,
        actorType: actorId ? 'USER' : 'SYSTEM',
        actorId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId ?? null,
        changes: (redact(entry.changes) as Prisma.InputJsonValue | undefined) ?? Prisma.DbNull,
        ip: ctx?.ip ?? null,
        userAgent: ctx?.userAgent ?? null,
        correlationId: ctx?.correlationId ?? null,
      },
    })
  }

  async list(
    tx: TenantTx,
    query: AuditQuery,
  ): Promise<{
    items: AuditLog[]
    page: { nextCursor: string | null; hasMore: boolean; limit: number }
  }> {
    const rows = await tx.auditLog.findMany({
      where: {
        ...(query.action ? { action: { startsWith: query.action } } : {}),
        ...(query.actorId ? { actorId: query.actorId } : {}),
        ...(query.from || query.to
          ? {
              createdAt: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {}),
              },
            }
          : {}),
        ...afterCursor(decodeCursor(query.cursor)),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    })
    const { items, page } = toPage(rows, query.limit)
    const actorIds = [
      ...new Set(items.map((r) => r.actorId).filter((id): id is string => Boolean(id))),
    ]
    const actors = await tx.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, name: true },
    })
    const names = new Map(actors.map((a) => [a.id, a.name]))
    return {
      items: items.map((r) => ({
        id: r.id,
        actorType: r.actorType,
        actorId: r.actorId,
        actorName: r.actorId ? (names.get(r.actorId) ?? null) : null,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        changes: (r.changes as Record<string, unknown> | null) ?? null,
        ip: r.ip,
        createdAt: r.createdAt.toISOString(),
      })),
      page,
    }
  }
}

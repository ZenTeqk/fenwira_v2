import { type AuditLog, type AuditQuery } from '@fenwira/contracts'
import { Prisma, type TenantTx } from '@fenwira/database'
import { Injectable } from '@nestjs/common'
import { redactAudit } from '../../core/security/redact'
import { likeLiteral } from '../../core/database/like'
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

/** Tenant audit trail. Always written inside the caller's transaction so it commits with the change. */
@Injectable()
export class AuditService {
  async write(tx: TenantTx, entry: AuditEntry): Promise<void> {
    const ctx = requestContext.get()
    const tenantId = entry.tenantId ?? ctx?.tenant?.tenantId
    if (!tenantId) throw new Error('Audit entry without tenant context')
    // An API-key request (docs/API_KEYS.md) has no human actor: the key itself is the actor,
    // recorded distinctly (ActorType.API_KEY) so audit readers never mistake it for a teammate.
    // A platform operator acting on a workspace (ADR-0027 operator console) is recorded as such,
    // never as a member of that workspace.
    const operatorId = ctx?.platform?.operatorId
    const actorId =
      entry.actorId === undefined
        ? (ctx?.apiKey?.id ?? operatorId ?? ctx?.auth?.userId ?? null)
        : entry.actorId
    await tx.auditLog.create({
      data: {
        tenantId,
        actorType: ctx?.apiKey
          ? 'API_KEY'
          : operatorId && actorId === operatorId
            ? 'PLATFORM_OPERATOR'
            : actorId
              ? 'USER'
              : 'SYSTEM',
        actorId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId ?? null,
        changes: (redactAudit(entry.changes) as Prisma.InputJsonValue | undefined) ?? Prisma.DbNull,
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
        ...(query.action ? { action: { startsWith: likeLiteral(query.action) } } : {}),
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

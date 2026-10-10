import { Database, type Prisma, type SecurityEventType, type TenantTx } from '@fenwira/database'
import { Inject, Injectable } from '@nestjs/common'
import { requestContext } from '../../core/context/request-context'

/** User-level security trail (append-only). Tenant actions go to the audit module instead. */
@Injectable()
export class SecurityEventsService {
  constructor(@Inject(Database) private readonly db: Database) {}

  async record(
    userId: string,
    type: SecurityEventType,
    metadata?: Record<string, unknown>,
    tx?: TenantTx,
  ): Promise<void> {
    const ctx = requestContext.get()
    const data = {
      userId,
      type,
      ip: ctx?.ip ?? null,
      userAgent: ctx?.userAgent ?? null,
      metadata: (metadata as Prisma.InputJsonValue | undefined) ?? undefined,
    }
    if (tx) await tx.securityEvent.create({ data })
    else await this.db.withGlobal((t) => t.securityEvent.create({ data }))
  }

  list(userId: string, limit = 50) {
    return this.db.withGlobal((tx) =>
      tx.securityEvent.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: limit }),
    )
  }
}

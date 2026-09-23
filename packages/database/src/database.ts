import { UUID_RE } from '@fenwira/config'
import { type Prisma, type PrismaClient } from '@prisma/client'
import { createPrismaClient } from './client'
import { SystemGateway } from './system'

/** Transaction handle with tenant (and optionally user) context bound for RLS. */
export type TenantTx = Prisma.TransactionClient
export type UserTx = Prisma.TransactionClient

export type WithTenantOptions = {
  userId?: string
  /** Interactive transaction timeout. Long jobs must batch into short transactions instead. */
  timeoutMs?: number
}

export class InvalidContextIdError extends Error {
  constructor(kind: 'tenant' | 'user', value: string) {
    super(`Invalid ${kind} id for database context: "${value}"`)
    this.name = 'InvalidContextIdError'
  }
}

function assertUuid(kind: 'tenant' | 'user', value: string): void {
  if (!UUID_RE.test(value)) throw new InvalidContextIdError(kind, value)
}

/**
 * The application's only database handle (docs/MULTI_TENANCY.md → Binding tenant context).
 * Tenant data is reachable exclusively through withTenant(); cross-tenant needs go through
 * `system` (named SECURITY DEFINER functions). The raw client never leaves this class.
 */
export class Database {
  readonly system: SystemGateway

  private constructor(private readonly prisma: PrismaClient) {
    this.system = new SystemGateway(prisma)
  }

  static connect(options: { url: string; poolSize?: number }): Database {
    return new Database(createPrismaClient(options))
  }

  /** @internal test/bootstrap seam */
  static fromClient(prisma: PrismaClient): Database {
    return new Database(prisma)
  }

  async withTenant<T>(
    tenantId: string,
    fn: (tx: TenantTx) => Promise<T>,
    opts: WithTenantOptions = {},
  ): Promise<T> {
    assertUuid('tenant', tenantId)
    if (opts.userId) assertUuid('user', opts.userId)
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true),
                                  set_config('app.current_user_id', ${opts.userId ?? ''}, true)`
        return fn(tx)
      },
      { timeout: opts.timeoutMs ?? 10_000, maxWait: 5_000 },
    )
  }

  /** Only for listing a user's own memberships/tenants before a tenant is chosen (X1). */
  async withUser<T>(userId: string, fn: (tx: UserTx) => Promise<T>): Promise<T> {
    assertUuid('user', userId)
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.current_user_id', ${userId}, true)`
      return fn(tx)
    })
  }

  /** Readiness probe: `SELECT 1` bounded by `timeoutMs`. */
  async ping(timeoutMs = 1000): Promise<void> {
    let timer: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`postgres ping timed out after ${timeoutMs}ms`)),
            timeoutMs,
          )
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect()
  }
}

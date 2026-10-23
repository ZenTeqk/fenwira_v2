import { randomToken, sha256, uuidv7 } from '@fenwira/config'
import { Database, type TenantTx } from '@fenwira/database'
import { Inject, Injectable } from '@nestjs/common'
import type IORedis from 'ioredis'
import { requestContext } from '../../core/context/request-context'
import {
  ACCESS_TTL_SECONDS,
  SESSION_ABSOLUTE_SECONDS,
  SESSION_IDLE_SECONDS,
} from '../../core/security/cookies'
import { REDIS } from '../../core/redis/redis.provider'
import { SecurityEventsService } from './security-events.service'

const IDLE_TIMEOUT_MS = SESSION_IDLE_SECONDS * 1000
const denyKey = (familyId: string) => `revoked_sid:${familyId}`
const idleEnd = (lastUsedAt: Date, expiresAt: Date) =>
  new Date(Math.min(lastUsedAt.getTime() + IDLE_TIMEOUT_MS, expiresAt.getTime()))

/** The session's two deadlines: absolute (fixed at sign-in) and idle (last activity + 3 h). */
export type SessionDeadlines = { expiresAt: Date; idleExpiresAt: Date }
export type IssuedSession = { familyId: string; refreshToken: string } & SessionDeadlines
export type RotateResult =
  | ({ ok: true; userId: string; familyId: string; refreshToken: string } & SessionDeadlines)
  | { ok: false; reason: 'UNKNOWN' | 'EXPIRED' | 'REVOKED' | 'REUSE_DETECTED' }

/**
 * Refresh-token sessions (docs/SECURITY.md → Sessions). A "session" to the user is a rotation
 * family; each refresh issues a child row and revokes its parent with reason ROTATED. Presenting a
 * ROTATED token again means it was stolen or replayed: the whole family is revoked.
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(REDIS) private readonly redis: IORedis,
    private readonly events: SecurityEventsService,
  ) {}

  async issue(userId: string, tx?: TenantTx): Promise<IssuedSession> {
    const refreshToken = randomToken()
    const familyId = uuidv7()
    const ctx = requestContext.get()
    const now = Date.now()
    const expiresAt = new Date(now + SESSION_ABSOLUTE_SECONDS * 1000)
    const create = (t: TenantTx) =>
      t.session.create({
        data: {
          userId,
          familyId,
          refreshTokenHash: sha256(refreshToken),
          userAgent: ctx?.userAgent ?? null,
          ip: ctx?.ip ?? null,
          lastUsedAt: new Date(now),
          expiresAt,
        },
      })
    if (tx) await create(tx)
    else await this.db.withGlobal(create)
    return { familyId, refreshToken, expiresAt, idleExpiresAt: idleEnd(new Date(now), expiresAt) }
  }

  /**
   * Rotates the refresh token. `active` = the user interacted since the last request (the web
   * app's activity header): only then does the idle clock restart; background polling and
   * passive refreshes carry the previous activity time forward. Neither extends the absolute limit.
   */
  async rotate(refreshToken: string, active = false): Promise<RotateResult> {
    const hash = sha256(refreshToken)
    const result = await this.db.withGlobal(async (tx): Promise<RotateResult> => {
      const current = await tx.session.findUnique({ where: { refreshTokenHash: hash } })
      if (!current) return { ok: false, reason: 'UNKNOWN' }
      if (current.revokedAt) {
        if (current.revokedReason === 'ROTATED') {
          await tx.session.updateMany({
            where: { familyId: current.familyId, revokedAt: null },
            data: { revokedAt: new Date(), revokedReason: 'REUSE_DETECTED' },
          })
          await this.events.record(
            current.userId,
            'REFRESH_TOKEN_REUSE',
            { familyId: current.familyId },
            tx,
          )
          await this.deny(current.familyId)
          return { ok: false, reason: 'REUSE_DETECTED' }
        }
        return { ok: false, reason: 'REVOKED' }
      }
      const now = Date.now()
      if (
        current.expiresAt.getTime() <= now ||
        current.lastUsedAt.getTime() + IDLE_TIMEOUT_MS <= now
      ) {
        await tx.session.update({
          where: { id: current.id },
          data: { revokedAt: new Date(), revokedReason: 'EXPIRED' },
        })
        return { ok: false, reason: 'EXPIRED' }
      }
      // Claim the parent atomically: a concurrent rotation of the same token sees count 0.
      const claimed = await tx.session.updateMany({
        where: { id: current.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'ROTATED' },
      })
      if (claimed.count === 0) return { ok: false, reason: 'REVOKED' }
      const next = randomToken()
      const ctx = requestContext.get()
      const lastUsedAt = active ? new Date(now) : current.lastUsedAt
      await tx.session.create({
        data: {
          userId: current.userId,
          familyId: current.familyId,
          parentId: current.id,
          refreshTokenHash: sha256(next),
          userAgent: ctx?.userAgent ?? current.userAgent,
          ip: ctx?.ip ?? current.ip,
          lastUsedAt,
          expiresAt: current.expiresAt, // absolute lifetime is fixed at login
        },
      })
      return {
        ok: true,
        userId: current.userId,
        familyId: current.familyId,
        refreshToken: next,
        expiresAt: current.expiresAt,
        idleExpiresAt: idleEnd(lastUsedAt, current.expiresAt),
      }
    })
    return result
  }

  /** Active sessions (one per family) for the settings page. */
  async list(userId: string) {
    return this.db.withGlobal(async (tx) => {
      const rows = await tx.session.findMany({
        where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { lastUsedAt: 'desc' },
      })
      const firstByFamily = await tx.session.groupBy({
        by: ['familyId'],
        where: { familyId: { in: rows.map((r) => r.familyId) } },
        _min: { createdAt: true },
      })
      const started = new Map(firstByFamily.map((f) => [f.familyId, f._min.createdAt]))
      return rows.map((r) => ({ ...r, startedAt: started.get(r.familyId) ?? r.createdAt }))
    })
  }

  async revokeFamily(userId: string, familyId: string, reason: string): Promise<boolean> {
    const updated = await this.db.withGlobal((tx) =>
      tx.session.updateMany({
        where: { userId, familyId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: reason },
      }),
    )
    await this.deny(familyId)
    return updated.count > 0
  }

  /** Revokes every session of the user except `keepFamilyId` (password change, "log out everywhere"). */
  async revokeAll(
    userId: string,
    reason: string,
    keepFamilyId?: string,
    tx?: TenantTx,
  ): Promise<number> {
    const run = async (t: TenantTx) => {
      const families = await t.session.findMany({
        where: {
          userId,
          revokedAt: null,
          ...(keepFamilyId ? { familyId: { not: keepFamilyId } } : {}),
        },
        select: { familyId: true },
        distinct: ['familyId'],
      })
      await t.session.updateMany({
        where: {
          userId,
          revokedAt: null,
          ...(keepFamilyId ? { familyId: { not: keepFamilyId } } : {}),
        },
        data: { revokedAt: new Date(), revokedReason: reason },
      })
      return families.map((f) => f.familyId)
    }
    const families = tx ? await run(tx) : await this.db.withGlobal(run)
    await Promise.all(families.map((f) => this.deny(f)))
    return families.length
  }

  /** Deadlines of the family's live row (GET /auth/me), or null when it has ended. */
  async deadlines(familyId: string): Promise<SessionDeadlines | null> {
    const row = await this.db.withGlobal((tx) =>
      tx.session.findFirst({
        where: { familyId, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
      }),
    )
    return row
      ? { expiresAt: row.expiresAt, idleExpiresAt: idleEnd(row.lastUsedAt, row.expiresAt) }
      : null
  }

  async touch(familyId: string): Promise<void> {
    await this.db.withGlobal((tx) =>
      tx.session.updateMany({
        where: { familyId, revokedAt: null },
        data: { lastUsedAt: new Date() },
      }),
    )
  }

  /** Access tokens are stateless for 15 minutes; this deny-set closes that window on revocation. */
  async isDenied(familyId: string): Promise<boolean> {
    return (await this.redis.exists(denyKey(familyId))) === 1
  }

  private async deny(familyId: string): Promise<void> {
    await this.redis.set(denyKey(familyId), '1', 'EX', ACCESS_TTL_SECONDS)
  }
}

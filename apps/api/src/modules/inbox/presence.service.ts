import { type Presence, type PresenceStatus } from '@fenwira/contracts'
import { Database } from '@fenwira/database'
import { Inject, Injectable } from '@nestjs/common'
import type IORedis from 'ioredis'
import { RealtimeEmitter } from '../../core/realtime/realtime-emitter'
import { REDIS } from '../../core/redis/redis.provider'

const STALE_MS = 60_000
const key = (tenantId: string) => `presence:${tenantId}`
type Entry = { status: PresenceStatus; lastSeen: string }

/**
 * Presence (docs/INBOX.md → Presence): a Redis hash per tenant, refreshed by a WebSocket heartbeat
 * every 20 s. No heartbeat for 60 s reads as OFFLINE. Status changes go to `tenant:{id}`.
 */
@Injectable()
export class PresenceService {
  constructor(
    @Inject(REDIS) private readonly redis: IORedis,
    @Inject(Database) private readonly db: Database,
    private readonly realtime: RealtimeEmitter,
  ) {}

  async heartbeat(
    tenantId: string,
    userId: string,
    status: 'ONLINE' | 'AWAY' = 'ONLINE',
  ): Promise<void> {
    const before = await this.read(tenantId, userId)
    const entry: Entry = { status, lastSeen: new Date().toISOString() }
    await this.redis.hset(key(tenantId), userId, JSON.stringify(entry))
    await this.redis.pexpire(key(tenantId), 24 * 3600 * 1000)
    if (before !== status) this.realtime.toTenant(tenantId, 'presence.updated', { userId, status })
  }

  async offline(tenantId: string, userId: string): Promise<void> {
    await this.redis.hdel(key(tenantId), userId)
    this.realtime.toTenant(tenantId, 'presence.updated', { userId, status: 'OFFLINE' })
  }

  /** Current status for one user (stale heartbeats count as OFFLINE). */
  async read(tenantId: string, userId: string): Promise<PresenceStatus> {
    const v = await this.redis.hget(key(tenantId), userId)
    return this.status(v)
  }

  /** All active members with their status. */
  async list(tenantId: string): Promise<Presence[]> {
    const [raw, members] = await Promise.all([
      this.redis.hgetall(key(tenantId)),
      this.db.withTenant(tenantId, (tx) =>
        tx.membership.findMany({
          where: { status: 'ACTIVE' },
          include: { user: { select: { id: true, name: true } } },
        }),
      ),
    ])
    return members.map((m) => {
      const v = raw[m.userId]
      return {
        userId: m.userId,
        name: m.user.name,
        status: this.status(v),
        lastSeen: v ? (JSON.parse(v) as Entry).lastSeen : null,
      }
    })
  }

  private status(v: string | null | undefined): PresenceStatus {
    if (!v) return 'OFFLINE'
    const e = JSON.parse(v) as Entry
    return Date.now() - new Date(e.lastSeen).getTime() > STALE_MS ? 'OFFLINE' : e.status
  }
}

import { type ComposeLock } from '@fenwira/contracts'
import { Inject, Injectable } from '@nestjs/common'
import type IORedis from 'ioredis'
import { AppError } from '../../core/http/app-error'
import { RealtimeEmitter } from '../../core/realtime/realtime-emitter'
import { REDIS } from '../../core/redis/redis.provider'

export const LOCK_TTL_MS = 30_000
type Holder = { userId: string; userName: string; expiresAt: string }
const key = (conversationId: string) => `lock:compose:${conversationId}`

/** Renew or release only if the stored holder is still `userId` (atomic). */
const RENEW = `
local v = redis.call('GET', KEYS[1])
if not v then return 0 end
if cjson.decode(v).userId ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
return 1`
const RELEASE = `
local v = redis.call('GET', KEYS[1])
if not v then return 0 end
if cjson.decode(v).userId ~= ARGV[1] then return 0 end
return redis.call('DEL', KEYS[1])`

/**
 * Compose lock (docs/INBOX.md → Collision control): one agent at a time types a reply. Held for
 * 30 s and renewed over WebSocket while the composer has content. Changes are broadcast to the
 * conversation room as `compose.lock`, which drives "Priya is replying…".
 */
@Injectable()
export class ComposeLockService {
  constructor(
    @Inject(REDIS) private readonly redis: IORedis,
    private readonly realtime: RealtimeEmitter,
  ) {}

  async get(conversationId: string): Promise<Holder | null> {
    const v = await this.redis.get(key(conversationId))
    return v ? (JSON.parse(v) as Holder) : null
  }

  async acquire(
    tenantId: string,
    conversationId: string,
    user: { id: string; name: string },
    opts: { force: boolean; canForce: boolean },
  ): Promise<ComposeLock> {
    const holder = this.value(user)
    const taken = await this.redis.set(
      key(conversationId),
      JSON.stringify(holder),
      'PX',
      LOCK_TTL_MS,
      'NX',
    )
    if (!taken) {
      const current = await this.get(conversationId)
      if (current && current.userId !== user.id) {
        if (!(opts.force && opts.canForce))
          throw new AppError(
            'COMPOSE_LOCKED',
            409,
            `${current.userName} is replying to this conversation.`,
            {
              holder: { id: current.userId, name: current.userName },
              expiresAt: current.expiresAt,
            },
          )
        await this.redis.set(key(conversationId), JSON.stringify(holder), 'PX', LOCK_TTL_MS)
      } else if (!(await this.renew(conversationId, user.id))) {
        // It expired between our two calls: take it now.
        await this.redis.set(key(conversationId), JSON.stringify(holder), 'PX', LOCK_TTL_MS)
      }
    }
    const lock = this.dto(conversationId, holder)
    this.realtime.toConversation(tenantId, conversationId, 'compose.lock', lock)
    return lock
  }

  /** Heartbeat from the holder's composer. Returns false if the lock is no longer theirs. */
  async renew(conversationId: string, userId: string, userName?: string): Promise<boolean> {
    const current = await this.get(conversationId)
    const value = this.value({ id: userId, name: userName ?? current?.userName ?? '' })
    const ok = await this.redis.eval(
      RENEW,
      1,
      key(conversationId),
      userId,
      JSON.stringify(value),
      String(LOCK_TTL_MS),
    )
    return ok === 1
  }

  async release(tenantId: string, conversationId: string, userId: string): Promise<void> {
    const released = await this.redis.eval(RELEASE, 1, key(conversationId), userId)
    if (released === 1)
      this.realtime.toConversation(
        tenantId,
        conversationId,
        'compose.lock',
        this.dto(conversationId, null),
      )
  }

  dto(conversationId: string, holder: Holder | null): ComposeLock {
    return {
      conversationId,
      holder: holder ? { id: holder.userId, name: holder.userName } : null,
      expiresAt: holder?.expiresAt ?? null,
    }
  }

  private value(user: { id: string; name: string }): Holder {
    return {
      userId: user.id,
      userName: user.name,
      expiresAt: new Date(Date.now() + LOCK_TTL_MS).toISOString(),
    }
  }
}

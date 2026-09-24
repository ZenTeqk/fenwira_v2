import { uuidv7 } from '@fenwira/config'
import { Inject, Injectable } from '@nestjs/common'
import type IORedis from 'ioredis'
import { AppError } from '../http/app-error'
import { REDIS } from '../redis/redis.provider'

export type RateLimitRule = { bucket: string; key: string; limit: number; windowSeconds: number }

/**
 * Redis sliding-window limiter (docs/SECURITY.md → Rate limits). Each hit is a member of a sorted
 * set scored by time; entries older than the window are trimmed before counting.
 */
@Injectable()
export class RateLimitService {
  constructor(@Inject(REDIS) private readonly redis: IORedis) {}

  /** Records a hit against every rule; throws 429 RATE_LIMITED (with retryAfter) if any is exceeded. */
  async consume(rules: RateLimitRule[]): Promise<void> {
    const now = Date.now()
    for (const rule of rules) {
      const redisKey = `rl:${rule.bucket}:${rule.key.toLowerCase()}`
      const windowMs = rule.windowSeconds * 1000
      const results = await this.redis
        .multi()
        .zremrangebyscore(redisKey, 0, now - windowMs)
        .zadd(redisKey, now, `${now}-${uuidv7()}`)
        .zcard(redisKey)
        .zrange(redisKey, 0, 0, 'WITHSCORES')
        .pexpire(redisKey, windowMs)
        .exec()
      const count = Number(results?.[2]?.[1] ?? 0)
      if (count > rule.limit) {
        const oldest = Number((results?.[3]?.[1] as string[] | undefined)?.[1] ?? now)
        const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000))
        throw new AppError('RATE_LIMITED', 429, 'Too many attempts. Please wait and try again.', {
          retryAfter,
        })
      }
    }
  }

  /** Clears a key after a successful action (e.g. failed-login counter after a good login). */
  async reset(bucket: string, key: string): Promise<void> {
    await this.redis.del(`rl:${bucket}:${key.toLowerCase()}`)
  }
}

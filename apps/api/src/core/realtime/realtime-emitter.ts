import { Emitter } from '@socket.io/redis-emitter'
import { createRedisConnection } from '@fenwira/queue'
import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common'
import type IORedis from 'ioredis'
import { CORE_CONFIG, type CoreConfig } from '../config/core-config'

export const tenantRoom = (tenantId: string) => `tenant:${tenantId}`
export const conversationRoom = (conversationId: string) => `conversation:${conversationId}`

/**
 * Publishes Socket.IO events through the Redis adapter from any process (api or worker), so
 * whichever api instance holds the socket delivers it (docs/ARCHITECTURE.md → Realtime).
 * Best effort: a Redis hiccup never fails the business operation that triggered the event.
 */
@Injectable()
export class RealtimeEmitter implements OnApplicationShutdown {
  private readonly redis: IORedis
  private readonly emitter: Emitter

  constructor(@Inject(CORE_CONFIG) config: CoreConfig) {
    this.redis = createRedisConnection(config.redisUrl, 'command')
    // The emitter calls publish() without handling its promise; under load a publish can hit the
    // 2 s command timeout and reject with no listener (an unhandled rejection). Realtime is
    // advisory, so a failed publish is dropped here instead.
    const redis = this.redis
    const publisher = {
      publish: (channel: string, message: string | Buffer) =>
        redis.publish(channel, message).catch(() => 0),
    }
    this.emitter = new Emitter(publisher)
  }

  toTenant(tenantId: string, event: string, payload: unknown): void {
    this.safe(() => this.emitter.to(tenantRoom(tenantId)).emit(event, payload))
  }

  /** One user's sockets (every tab), e.g. notifications. */
  toUser(userId: string, event: string, payload: unknown): void {
    this.safe(() => this.emitter.to(`user:${userId}`).emit(event, payload))
  }

  /** Conversation-scoped events also reach the tenant room (lists, badges). */
  toConversation(tenantId: string, conversationId: string, event: string, payload: unknown): void {
    this.safe(() =>
      this.emitter
        .to([tenantRoom(tenantId), conversationRoom(conversationId)])
        .emit(event, payload),
    )
  }

  private safe(fn: () => void): void {
    try {
      fn()
    } catch {
      // Realtime is advisory; clients refetch on reconnect.
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => this.redis.disconnect())
  }
}

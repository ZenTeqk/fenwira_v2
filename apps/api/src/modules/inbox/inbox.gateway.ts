import { Database } from '@fenwira/database'
import { Inject, Logger } from '@nestjs/common'
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets'
import { type Server, type Socket } from 'socket.io'
import { ComposeLockService } from './compose-lock.service'
import { PresenceService } from './presence.service'

type SocketData = { userId?: string; tenantId?: string }
const UUID = /^[0-9a-f-]{36}$/i

/**
 * Inbox socket traffic (docs/INBOX.md): compose-lock heartbeats while an agent types and presence
 * heartbeats every 20 s. Authentication and tenant rooms come from RealtimeGateway.
 */
@WebSocketGateway()
export class InboxGateway implements OnGatewayDisconnect {
  private readonly logger = new Logger('InboxGateway')
  @WebSocketServer() server!: Server

  constructor(
    private readonly locks: ComposeLockService,
    private readonly presence: PresenceService,
    @Inject(Database) private readonly db: Database,
  ) {}

  @SubscribeMessage('compose.heartbeat')
  async composeHeartbeat(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { conversationId?: string },
  ): Promise<{ ok: boolean }> {
    const { userId, tenantId } = socket.data as SocketData
    if (!userId || !tenantId || !body?.conversationId || !UUID.test(body.conversationId))
      return { ok: false }
    // Only the holder can renew; the lock key is per conversation, and the conversation id is
    // checked against the socket's tenant so a foreign id can't be probed.
    const owned = await this.db.withTenant(tenantId, (tx) =>
      tx.conversation.findFirst({ where: { id: body.conversationId }, select: { id: true } }),
    )
    if (!owned) return { ok: false }
    return { ok: await this.locks.renew(body.conversationId, userId) }
  }

  @SubscribeMessage('presence.heartbeat')
  async presenceHeartbeat(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { status?: 'ONLINE' | 'AWAY' },
  ): Promise<{ ok: boolean }> {
    const { userId, tenantId } = socket.data as SocketData
    if (!userId || !tenantId) return { ok: false }
    await this.presence.heartbeat(tenantId, userId, body?.status === 'AWAY' ? 'AWAY' : 'ONLINE')
    return { ok: true }
  }

  /** Last tab closed → OFFLINE right away (otherwise the 60 s heartbeat timeout applies). */
  async handleDisconnect(socket: Socket): Promise<void> {
    const { userId, tenantId } = socket.data as SocketData
    if (!userId || !tenantId) return
    try {
      const others = await this.server.in(`user:${userId}`).fetchSockets()
      if (!others.some((s) => (s.data as SocketData).tenantId === tenantId))
        await this.presence.offline(tenantId, userId)
    } catch (err) {
      this.logger.warn(`presence update on disconnect failed: ${(err as Error).message}`)
    }
  }
}

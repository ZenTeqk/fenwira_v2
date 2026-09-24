import { Logger } from '@nestjs/common'
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets'
import { parse as parseCookies } from 'cookie'
import { type Server, type Socket } from 'socket.io'
import { ACCESS_COOKIE } from '../../core/security/cookies'
import { JwtService, SessionService } from '../identity'
import { TenantAccessService } from '../tenancy'

type SocketData = { userId?: string; tenantId?: string }

export const tenantRoom = (tenantId: string) => `tenant:${tenantId}`
export const userRoom = (userId: string) => `user:${userId}`

/**
 * docs/ARCHITECTURE.md → Realtime. Authenticates from the fw_at cookie at the handshake and only
 * joins `tenant:{id}` after the same membership check the HTTP TenantGuard uses. `tenant.switch`
 * re-checks and moves the socket between tenant rooms.
 */
@WebSocketGateway()
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger('RealtimeGateway')
  @WebSocketServer() server!: Server

  constructor(
    private readonly jwt: JwtService,
    private readonly sessions: SessionService,
    private readonly access: TenantAccessService,
  ) {}

  async handleConnection(socket: Socket): Promise<void> {
    const data = socket.data as SocketData
    try {
      const cookies = parseCookies(socket.handshake.headers.cookie ?? '')
      const claims = cookies[ACCESS_COOKIE] ? this.jwt.verifyAccess(cookies[ACCESS_COOKIE]) : null
      if (!claims || (await this.sessions.isDenied(claims.sid)))
        return this.reject(socket, 'UNAUTHENTICATED')
      data.userId = claims.sub
      await socket.join(userRoom(claims.sub))
      const tenantId = (socket.handshake.auth as { tenantId?: string } | undefined)?.tenantId
      if (tenantId) {
        const access = await this.access.resolve(claims.sub, tenantId)
        if (!access.ok) return this.reject(socket, 'TENANT_NOT_FOUND')
        data.tenantId = tenantId
        await socket.join(tenantRoom(tenantId))
      }
      socket.emit('session.ready', { tenantId: data.tenantId ?? null })
    } catch (err) {
      this.logger.warn(`socket rejected: ${(err as Error).message}`)
      this.reject(socket, 'UNAUTHENTICATED')
    }
  }

  @SubscribeMessage('tenant.switch')
  async switchTenant(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { tenantId?: string },
  ): Promise<{ ok: boolean; error?: string }> {
    const data = socket.data as SocketData
    if (!data.userId) return { ok: false, error: 'UNAUTHENTICATED' }
    const access = await this.access.resolve(data.userId, body?.tenantId)
    if (!access.ok) return { ok: false, error: 'TENANT_NOT_FOUND' }
    if (data.tenantId) await socket.leave(tenantRoom(data.tenantId))
    data.tenantId = access.context.tenantId
    await socket.join(tenantRoom(access.context.tenantId))
    return { ok: true }
  }

  /** Emit to everyone currently in a tenant's room. */
  emitToTenant(tenantId: string, event: string, payload: unknown): void {
    this.server.to(tenantRoom(tenantId)).emit(event, payload)
  }

  private reject(socket: Socket, code: string): void {
    socket.emit('session.error', { code })
    socket.disconnect(true)
  }
}

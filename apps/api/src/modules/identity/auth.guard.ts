import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { type Request } from 'express'
import { requestContext } from '../../core/context/request-context'
import { AppError } from '../../core/http/app-error'
import { ACCESS_COOKIE } from '../../core/security/cookies'
import {
  OPTIONAL_AUTH_KEY,
  PUBLIC_KEY,
  PLATFORM_PERMISSION_KEY,
} from '../../core/security/decorators'
import { JwtService } from './jwt.service'
import { SessionService } from './session.service'

/**
 * Global and default-deny: every HTTP route needs a valid access token unless marked @Public.
 * The token carries user + session family only; tenant and role are resolved per request.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true
    // ApiKeyGuard (registered first) already authenticated this request; cookies don't apply.
    if (requestContext.get()?.apiKey) return true
    const targets = [context.getHandler(), context.getClass()]
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)
    const optional = this.reflector.getAllAndOverride<boolean>(OPTIONAL_AUTH_KEY, targets)
    if (this.reflector.getAllAndOverride<string>(PLATFORM_PERMISSION_KEY, targets)) return true
    const req = context.switchToHttp().getRequest<Request>()
    const token = (req.cookies as Record<string, string | undefined> | undefined)?.[ACCESS_COOKIE]

    if (isPublic && !optional) return true
    const claims = token ? this.jwt.verifyAccess(token) : null
    if (claims && !(await this.sessions.isDenied(claims.sid))) {
      requestContext.patch({
        auth: { userId: claims.sub, sessionId: claims.sid },
        userId: claims.sub,
      })
      return true
    }
    if (isPublic || optional) return true
    throw token
      ? new AppError('SESSION_EXPIRED', 401, 'Your session has expired.')
      : new AppError('UNAUTHENTICATED', 401, 'Please sign in.')
  }
}

/** The authenticated caller; only valid on routes behind AuthGuard. */
export function currentAuth(): { userId: string; sessionId: string } {
  const auth = requestContext.get()?.auth
  if (!auth) throw new AppError('UNAUTHENTICATED', 401, 'Please sign in.')
  return auth
}

/** The API key authenticating this request, or undefined for an ordinary session request. */
export function currentApiKey(): { id: string; name: string; tenantId: string } | undefined {
  return requestContext.get()?.apiKey
}

/**
 * The acting user's id for `createdBy`/actor columns on the handful of allowlisted API-key
 * mutations (docs/API_KEYS.md): a real user id for a session request, `null` for an API-key
 * request (those columns are nullable — there is no human actor; the audit trail instead records
 * `actorType: 'API_KEY'`). Throws only when neither auth mechanism authenticated the request.
 */
export function currentActorId(): string | null {
  const ctx = requestContext.get()
  if (ctx?.auth) return ctx.auth.userId
  if (ctx?.apiKey) return null
  throw new AppError('UNAUTHENTICATED', 401, 'Please sign in.')
}

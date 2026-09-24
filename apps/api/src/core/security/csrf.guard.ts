import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { type Request } from 'express'
import { CORE_CONFIG, type CoreConfig } from '../config/core-config'
import { AppError } from '../http/app-error'
import { safeEqual } from '@fenwira/config'
import { ACCESS_COOKIE, CSRF_COOKIE } from './cookies'
import { SKIP_CSRF_KEY } from './decorators'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * docs/SECURITY.md → CSRF. Every mutation: if the browser sent Origin, it must be WEB_ORIGIN.
 * Cookie-authenticated mutations additionally need X-CSRF-Token equal to the fw_csrf cookie
 * (double submit). The cookie is HttpOnly; clients get the value from login/refresh/me bodies.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true
    const req = context.switchToHttp().getRequest<Request>()
    if (SAFE_METHODS.has(req.method)) return true

    const origin = req.header('origin')
    if (origin && this.config.webOrigin && origin !== this.config.webOrigin) {
      throw new AppError('CSRF_FAILED', 403, 'Request origin is not allowed.')
    }

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    const cookies = (req.cookies ?? {}) as Record<string, string | undefined>
    if (skip || !cookies[ACCESS_COOKIE]) return true

    const header = req.header('x-csrf-token')
    const cookie = cookies[CSRF_COOKIE]
    if (!header || !cookie || !safeEqual(header, cookie)) {
      throw new AppError(
        'CSRF_FAILED',
        403,
        'Missing or invalid CSRF token. Reload the page and try again.',
      )
    }
    return true
  }
}

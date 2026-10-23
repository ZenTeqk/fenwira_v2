import { platformLoginSchema, platformVerifySchema, platformReauthSchema } from '@fenwira/contracts'
import { ACTIVITY_HEADER } from '../../core/security/cookies'
import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common'
import { type Request, type Response } from 'express'
import { type z } from 'zod'
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe'
import { PlatformAccess, Public, SkipCsrf } from '../../core/security/decorators'
import { IDENTITY_OPTIONS, type IdentityOptions } from '../identity'
import {
  PLATFORM_COOKIE,
  PLATFORM_CSRF_COOKIE,
  PRIVILEGE_MS,
  PlatformAuthService,
} from './platform-auth.service'

@Controller('platform/auth')
export class PlatformAuthController {
  constructor(
    private readonly auth: PlatformAuthService,
    @Inject(IDENTITY_OPTIONS) private readonly options: IdentityOptions,
  ) {}
  @Public()
  @SkipCsrf()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(platformLoginSchema)) body: z.infer<typeof platformLoginSchema>,
  ) {
    return { data: await this.auth.login(body.email, body.password) }
  }
  @Public()
  @SkipCsrf()
  @Post('verify')
  @HttpCode(200)
  async verify(
    @Body(new ZodValidationPipe(platformVerifySchema)) body: z.infer<typeof platformVerifySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.verify(body.challengeToken, body.code)
    const opts = {
      httpOnly: true,
      secure: this.options.cookies.secure,
      sameSite: 'strict' as const,
      path: '/api/v1/platform',
      maxAge: PRIVILEGE_MS,
    }
    res.cookie(PLATFORM_COOKIE, result.token, opts)
    res.cookie(PLATFORM_CSRF_COOKIE, result.csrfToken, opts)
    return { data: { csrfToken: result.csrfToken, expiresAt: result.expiresAt } }
  }
  @PlatformAccess('commercial.read')
  @Get('me')
  async me(@Req() req: Request) {
    return {
      data: await this.auth.authenticate(
        req.cookies?.[PLATFORM_COOKIE],
        req.cookies?.[PLATFORM_CSRF_COOKIE],
        req.header(ACTIVITY_HEADER) === '1',
      ),
    }
  }
  @PlatformAccess('commercial.read')
  @Post('reauth')
  @HttpCode(204)
  async reauth(
    @Body(new ZodValidationPipe(platformReauthSchema)) body: z.infer<typeof platformReauthSchema>,
  ) {
    await this.auth.reauthenticate(body.password, body.code)
  }
  @PlatformAccess('commercial.read')
  @Post('logout')
  @HttpCode(204)
  async logout(@Res({ passthrough: true }) res: Response) {
    await this.auth.logout()
    for (const key of [PLATFORM_COOKIE, PLATFORM_CSRF_COOKIE])
      res.clearCookie(key, {
        httpOnly: true,
        secure: this.options.cookies.secure,
        sameSite: 'strict',
        path: '/api/v1/platform',
      })
  }
}

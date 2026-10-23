import {
  changePasswordRequestSchema,
  forgotPasswordRequestSchema,
  type LoginResult,
  loginRequestSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
  type SecurityEvent,
  type Session,
  tokenRequestSchema,
  twoFactorDisableRequestSchema,
  twoFactorEnableRequestSchema,
  twoFactorVerifyRequestSchema,
  type TwoFactorSetup,
  updateProfileRequestSchema,
  type User,
} from '@fenwira/contracts'
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common'
import { type Request, type Response } from 'express'
import { z } from 'zod'
import { AppError } from '../../core/http/app-error'
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe'
import {
  ACTIVITY_HEADER,
  clearSessionCookies,
  REFRESH_COOKIE,
  setSessionCookies,
} from '../../core/security/cookies'
import { Public, SkipCsrf } from '../../core/security/decorators'
import { currentAuth } from './auth.guard'
import { IDENTITY_OPTIONS, type IdentityOptions } from './identity.options'
import { type AuthOutcome, IdentityService } from './identity.service'
import { SecurityEventsService } from './security-events.service'
import { SessionService } from './session.service'

/** Auth endpoints (docs/API_SPEC.md → Auth & identity). No tenant header. */
@Controller()
export class AuthController {
  constructor(
    private readonly identity: IdentityService,
    private readonly sessions: SessionService,
    private readonly securityEvents: SecurityEventsService,
    @Inject(IDENTITY_OPTIONS) private readonly options: IdentityOptions,
  ) {}

  @Public()
  @Post('auth/register')
  @HttpCode(201)
  async register(
    @Body(new ZodValidationPipe(registerRequestSchema)) body: z.infer<typeof registerRequestSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ data: LoginResult }> {
    return this.respond(await this.identity.register(body), res)
  }

  @Public()
  @Post('auth/login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: z.infer<typeof loginRequestSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ data: LoginResult }> {
    const outcome = await this.identity.login(body.email, body.password)
    if (outcome.result.status === 'TOTP_REQUIRED') res.status(202)
    return this.respond(outcome, res)
  }

  @Public()
  @Post('auth/2fa/verify')
  @HttpCode(200)
  async verifyTwoFactor(
    @Body(new ZodValidationPipe(twoFactorVerifyRequestSchema))
    body: z.infer<typeof twoFactorVerifyRequestSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ data: LoginResult }> {
    return this.respond(await this.identity.verifyTwoFactor(body.challengeToken, body.code), res)
  }

  /** Reads the SameSite=Strict refresh cookie; safe without the CSRF header (Origin still checked). */
  @Public()
  @SkipCsrf()
  @Post('auth/refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{
    data: { csrfToken: string; session: { expiresAt: string; idleExpiresAt: string } }
  }> {
    const cookies = req.cookies as Record<string, string | undefined>
    try {
      const tokens = await this.identity.refresh(
        cookies[REFRESH_COOKIE],
        req.header(ACTIVITY_HEADER) === '1',
      )
      setSessionCookies(res, this.options.cookies, tokens)
      return {
        data: {
          csrfToken: tokens.csrfToken,
          session: {
            expiresAt: tokens.expiresAt.toISOString(),
            idleExpiresAt: tokens.idleExpiresAt.toISOString(),
          },
        },
      }
    } catch (err) {
      clearSessionCookies(res, this.options.cookies)
      throw err
    }
  }

  @Post('auth/logout')
  @HttpCode(204)
  async logout(@Res({ passthrough: true }) res: Response): Promise<void> {
    const auth = currentAuth()
    await this.identity.logout(auth.userId, auth.sessionId)
    clearSessionCookies(res, this.options.cookies)
  }

  @Public()
  @Post('auth/email/verify')
  @HttpCode(204)
  async verifyEmail(
    @Body(new ZodValidationPipe(tokenRequestSchema)) body: { token: string },
  ): Promise<void> {
    await this.identity.verifyEmail(body.token)
  }

  @Post('auth/email/resend')
  @HttpCode(202)
  async resendVerification(): Promise<void> {
    await this.identity.resendVerification(currentAuth().userId)
  }

  @Public()
  @Post('auth/password/forgot')
  @HttpCode(202)
  async forgot(
    @Body(new ZodValidationPipe(forgotPasswordRequestSchema)) body: { email: string },
  ): Promise<void> {
    await this.identity.requestPasswordReset(body.email)
  }

  @Public()
  @Post('auth/password/reset')
  @HttpCode(204)
  async reset(
    @Body(new ZodValidationPipe(resetPasswordRequestSchema))
    body: z.infer<typeof resetPasswordRequestSchema>,
  ): Promise<void> {
    await this.identity.resetPassword(body.token, body.password)
  }

  // ------------------------------------------------------------------ /me (self-service)

  @Patch('me')
  async updateProfile(
    @Body(new ZodValidationPipe(updateProfileRequestSchema))
    body: z.infer<typeof updateProfileRequestSchema>,
  ): Promise<{ data: User }> {
    return { data: await this.identity.updateProfile(currentAuth().userId, body) }
  }

  @Post('me/password')
  @HttpCode(204)
  async changePassword(
    @Body(new ZodValidationPipe(changePasswordRequestSchema))
    body: z.infer<typeof changePasswordRequestSchema>,
  ): Promise<void> {
    const auth = currentAuth()
    await this.identity.changePassword(
      auth.userId,
      auth.sessionId,
      body.currentPassword,
      body.newPassword,
    )
  }

  @Get('me/sessions')
  async listSessions(): Promise<{ data: Session[] }> {
    const auth = currentAuth()
    const rows = await this.sessions.list(auth.userId)
    return {
      data: rows.map((r) => ({
        id: r.familyId,
        userAgent: r.userAgent,
        ip: r.ip,
        createdAt: r.startedAt.toISOString(),
        lastUsedAt: r.lastUsedAt.toISOString(),
        current: r.familyId === auth.sessionId,
      })),
    }
  }

  @Delete('me/sessions/:id')
  @HttpCode(204)
  async revokeSession(@Param('id', new ZodValidationPipe(z.uuid())) id: string): Promise<void> {
    const auth = currentAuth()
    if (!(await this.sessions.revokeFamily(auth.userId, id, 'USER_REVOKED')))
      throw AppError.notFound('Session not found.')
    await this.securityEvents.record(auth.userId, 'SESSION_REVOKED', { sessionId: id })
  }

  @Post('me/sessions/revoke-others')
  @HttpCode(200)
  async revokeOthers(): Promise<{ data: { revoked: number } }> {
    const auth = currentAuth()
    const revoked = await this.sessions.revokeAll(auth.userId, 'USER_REVOKED_ALL', auth.sessionId)
    await this.securityEvents.record(auth.userId, 'ALL_SESSIONS_REVOKED', { revoked })
    return { data: { revoked } }
  }

  @Get('me/security-events')
  async listSecurityEvents(): Promise<{ data: SecurityEvent[] }> {
    const rows = await this.securityEvents.list(currentAuth().userId)
    return {
      data: rows.map((r) => ({
        id: r.id,
        type: r.type,
        ip: r.ip,
        userAgent: r.userAgent,
        createdAt: r.createdAt.toISOString(),
      })),
    }
  }

  @Post('me/2fa/setup')
  @HttpCode(200)
  async setupTwoFactor(): Promise<{ data: TwoFactorSetup }> {
    return { data: await this.identity.setupTwoFactor(currentAuth().userId) }
  }

  @Post('me/2fa/enable')
  @HttpCode(200)
  async enableTwoFactor(
    @Body(new ZodValidationPipe(twoFactorEnableRequestSchema)) body: { code: string },
  ): Promise<{ data: { backupCodes: string[] } }> {
    return {
      data: { backupCodes: await this.identity.enableTwoFactor(currentAuth().userId, body.code) },
    }
  }

  @Post('me/2fa/disable')
  @HttpCode(204)
  async disableTwoFactor(
    @Body(new ZodValidationPipe(twoFactorDisableRequestSchema))
    body: z.infer<typeof twoFactorDisableRequestSchema>,
  ): Promise<void> {
    await this.identity.disableTwoFactor(currentAuth().userId, body.password, body.code)
  }

  private respond(outcome: AuthOutcome, res: Response): { data: LoginResult } {
    if (outcome.tokens) setSessionCookies(res, this.options.cookies, outcome.tokens)
    return { data: outcome.result }
  }
}

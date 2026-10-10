import { decryptSecret, randomToken, safeEqual, sha256 } from '@fenwira/config'
import { PLATFORM_PERMISSIONS, type PlatformMe } from '@fenwira/contracts'
import { Database, type Prisma } from '@fenwira/database'
import { Inject, Injectable } from '@nestjs/common'
import { redactAudit } from '../../core/security/redact'
import { MetricsService } from '../../core/metrics/metrics.service'
import { PinoLogger } from 'nestjs-pino'
import { requestContext } from '../../core/context/request-context'
import { AppError } from '../../core/http/app-error'
import { RateLimitService } from '../../core/security/rate-limit.service'
import {
  IDENTITY_OPTIONS,
  type IdentityOptions,
  PasswordService,
  SessionService,
  verifyTotp,
} from '../identity'
import { REDIS } from '../../core/redis/redis.provider'
import type IORedis from 'ioredis'

export const PLATFORM_COOKIE = 'fw_platform'
export const PLATFORM_CSRF_COOKIE = 'fw_platform_csrf'
export const PRIVILEGE_MS = 30 * 60_000
export const PRIVILEGE_IDLE_MS = 10 * 60_000
export const FRESH_MFA_MS = 5 * 60_000

@Injectable()
export class PlatformAuthService {
  constructor(
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger,
    @Inject(Database) private readonly db: Database,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly limits: RateLimitService,
    @Inject(REDIS) private readonly redis: IORedis,
    @Inject(IDENTITY_OPTIONS) private readonly options: IdentityOptions,
  ) {}

  async audit(
    action: string,
    outcome: string,
    operatorId?: string,
    workspaceId?: string,
    details?: Record<string, unknown>,
  ) {
    this.metrics.platformEvents.inc({ action, outcome })
    if (outcome !== 'SUCCESS') requestContext.patch({ platformFailureAudited: true })
    this.logger.info({ action, outcome, operatorId, tenantId: workspaceId }, 'platform operation')
    await this.db.withGlobal((tx) =>
      tx.platformAudit.createMany({
        data: {
          operatorId,
          workspaceId,
          action,
          outcome,
          correlationId: requestContext.correlationId(),
          ...(details ? { details: redactAudit(details) as Prisma.InputJsonValue } : {}),
        },
      }),
    )
  }

  async login(email: string, password: string) {
    await this.limits.consume([
      {
        bucket: 'platform:login:ip',
        key: requestContext.get()?.ip ?? 'unknown',
        limit: 10,
        windowSeconds: 60,
      },
      { bucket: 'platform:login:account', key: email, limit: 5, windowSeconds: 60 },
    ])
    const user = await this.db.withGlobal((tx) =>
      tx.user.findUnique({ where: { email }, include: { twoFactor: true } }),
    )
    const grant = user
      ? await this.db.withGlobal((tx) =>
          tx.platformGrant.findUnique({ where: { userId: user.id } }),
        )
      : null
    const validPassword = await this.passwords.verify(user?.passwordHash, password)
    if (
      !user ||
      !validPassword ||
      user.disabledAt ||
      !user.emailVerifiedAt ||
      !grant ||
      grant.revokedAt ||
      !user.twoFactor?.enabledAt
    ) {
      await this.audit('platform.login', 'DENIED', user?.id)
      throw new AppError(
        'INVALID_CREDENTIALS',
        401,
        'Platform sign-in is unavailable for these credentials.',
      )
    }
    const challengeToken = randomToken()
    await this.db.withPlatform(user.id, async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id}::uuid FOR SHARE`
      const current = await tx.user.findUniqueOrThrow({ where: { id: user.id } })
      const currentGrant = await tx.platformGrant.findUniqueOrThrow({ where: { userId: user.id } })
      if (current.passwordHash !== user.passwordHash || currentGrant.version !== grant.version)
        throw new AppError('INVALID_CREDENTIALS', 401, 'Sign in again.')
      const parent = await this.sessions.issue(user.id, tx)
      const expiresAt = new Date(Date.now() + 5 * 60_000)
      await tx.session.updateMany({ where: { familyId: parent.familyId }, data: { expiresAt } })
      await tx.platformChallenge.create({
        data: {
          userId: user.id,
          tokenHash: sha256(challengeToken),
          grantVersion: grant.version,
          parentFamilyId: parent.familyId,
          expiresAt,
        },
      })
    })
    return { challengeToken }
  }

  private async factor(userId: string, code: string) {
    const cred = await this.db.withGlobal((tx) =>
      tx.twoFactorCredential.findUnique({ where: { userId } }),
    )
    const step = cred?.enabledAt
      ? verifyTotp(decryptSecret(this.options.keyRing, cred.secretCiphertext), code)
      : null
    if (
      step === null ||
      (await this.redis.set(`totp_used:${userId}:${step}`, '1', 'EX', 120, 'NX')) !== 'OK'
    ) {
      await this.audit('platform.mfa', 'DENIED', userId)
      throw new AppError('INVALID_CODE', 401, 'Enter a fresh authenticator code.')
    }
  }

  async verify(challengeToken: string, code: string) {
    const hash = sha256(challengeToken)
    await this.limits.consume([
      {
        bucket: 'platform:mfa:challenge',
        key: Buffer.from(hash).toString('hex'),
        limit: 5,
        windowSeconds: 300,
      },
      {
        bucket: 'platform:mfa:ip',
        key: requestContext.get()?.ip ?? 'unknown',
        limit: 20,
        windowSeconds: 300,
      },
    ])
    const challenge = await this.db.withGlobal((tx) =>
      tx.platformChallenge.findUnique({ where: { tokenHash: hash } }),
    )
    if (
      !challenge ||
      !challenge.parentFamilyId ||
      challenge.consumedAt ||
      challenge.expiresAt <= new Date()
    )
      throw new AppError('TOKEN_INVALID', 401, 'Sign in again.')
    const activeParent = await this.db.withGlobal((tx) =>
      tx.session.findFirst({
        where: {
          familyId: challenge.parentFamilyId!,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      }),
    )
    if (!activeParent) throw new AppError('TOKEN_INVALID', 401, 'Sign in again.')
    await this.factor(challenge.userId, code)
    const token = randomToken(),
      csrfToken = randomToken(),
      now = new Date()
    const session = await this.db.withPlatform(challenge.userId, async (tx) => {
      const grant = await tx.platformGrant.findUniqueOrThrow({
        where: { userId: challenge.userId },
      })
      if (grant.version !== challenge.grantVersion)
        throw new AppError('FORBIDDEN', 403, 'Authorization changed; sign in again.')
      const claimed = await tx.platformChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      })
      if (!claimed.count) throw new AppError('TOKEN_INVALID', 401, 'Sign in again.')
      const parents = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM sessions WHERE family_id = ${challenge.parentFamilyId}::uuid AND revoked_at IS NULL AND expires_at > now() FOR SHARE`
      if (!parents.length) throw new AppError('TOKEN_INVALID', 401, 'Sign in again.')
      await tx.session.updateMany({
        where: { familyId: challenge.parentFamilyId! },
        data: { expiresAt: new Date(now.getTime() + PRIVILEGE_MS) },
      })
      return tx.platformSession.create({
        data: {
          userId: challenge.userId,
          parentFamilyId: challenge.parentFamilyId!,
          tokenHash: sha256(token),
          csrfHash: sha256(csrfToken),
          grantVersion: grant.version,
          mfaAt: now,
          expiresAt: new Date(now.getTime() + PRIVILEGE_MS),
        },
      })
    })
    await this.audit('platform.login', 'SUCCESS', challenge.userId)
    return { token, csrfToken, expiresAt: session.expiresAt.toISOString() }
  }

  async authenticate(
    token: string | undefined,
    csrfCookie: string | undefined,
  ): Promise<PlatformMe> {
    if (!token || !csrfCookie)
      throw new AppError('UNAUTHENTICATED', 401, 'Sign in to Platform Operations.')
    const session = await this.db.withGlobal((tx) =>
      tx.platformSession.findUnique({ where: { tokenHash: sha256(token) } }),
    )
    const now = new Date()
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= now ||
      session.lastUsedAt.getTime() + PRIVILEGE_IDLE_MS <= now.getTime() ||
      !safeEqual(session.csrfHash, sha256(csrfCookie))
    )
      throw new AppError('SESSION_EXPIRED', 401, 'Platform session ended. Sign in again.')
    const valid = await this.db.withGlobal(async (tx) => {
      const [grant, user, cred, parent] = await Promise.all([
        tx.platformGrant.findUnique({ where: { userId: session.userId } }),
        tx.user.findUnique({ where: { id: session.userId } }),
        tx.twoFactorCredential.findUnique({ where: { userId: session.userId } }),
        tx.session.findFirst({
          where: { familyId: session.parentFamilyId, revokedAt: null, expiresAt: { gt: now } },
        }),
      ])
      return (
        grant &&
        !grant.revokedAt &&
        grant.version === session.grantVersion &&
        user &&
        !user.disabledAt &&
        user.emailVerifiedAt &&
        cred?.enabledAt &&
        parent
      )
    })
    if (!valid) throw new AppError('FORBIDDEN', 403, 'Platform authorization ended.')
    await this.db.withGlobal((tx) =>
      tx.platformSession.update({ where: { id: session.id }, data: { lastUsedAt: now } }),
    )
    requestContext.patch({
      platform: { operatorId: session.userId, sessionId: session.id, mfaAt: session.mfaAt },
      userId: session.userId,
    })
    return {
      operatorId: session.userId,
      permissions: [...PLATFORM_PERMISSIONS],
      expiresAt: session.expiresAt.toISOString(),
      csrfToken: csrfCookie,
    }
  }

  async reauthenticate(password: string, code: string) {
    const ctx = requestContext.get()?.platform
    if (!ctx) throw new AppError('UNAUTHENTICATED', 401, 'Sign in again.')
    await this.limits.consume([
      { bucket: 'platform:reauth', key: ctx.operatorId, limit: 5, windowSeconds: 300 },
    ])
    const user = await this.db.withGlobal((tx) =>
      tx.user.findUniqueOrThrow({ where: { id: ctx.operatorId } }),
    )
    if (!(await this.passwords.verify(user.passwordHash, password))) {
      await this.audit('platform.reauth', 'DENIED', ctx.operatorId)
      throw new AppError('INVALID_CREDENTIALS', 401, 'Invalid credentials.')
    }
    await this.factor(ctx.operatorId, code)
    await this.db.withGlobal((tx) =>
      tx.platformSession.update({ where: { id: ctx.sessionId }, data: { mfaAt: new Date() } }),
    )
    await this.audit('platform.reauth', 'SUCCESS', ctx.operatorId)
  }

  async logout() {
    const ctx = requestContext.get()?.platform
    if (!ctx) return
    await this.db.withGlobal((tx) =>
      tx.platformSession.update({ where: { id: ctx.sessionId }, data: { revokedAt: new Date() } }),
    )
    const session = await this.db.withGlobal((tx) =>
      tx.platformSession.findUniqueOrThrow({ where: { id: ctx.sessionId } }),
    )
    await this.sessions.revokeFamily(ctx.operatorId, session.parentFamilyId, 'PLATFORM_LOGOUT')
    await this.audit('platform.logout', 'SUCCESS', ctx.operatorId)
  }
}

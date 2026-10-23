import { decryptSecret, encryptSecret, randomToken, sha256, uuidv7 } from '@fenwira/config'
import { ACCESS_TTL_SECONDS } from '../../core/security/cookies'
import { type LoginResult, type User as UserDto } from '@fenwira/contracts'
import { Database, type TenantTx } from '@fenwira/database'
import { Inject, Injectable } from '@nestjs/common'
import type IORedis from 'ioredis'
import { requestContext } from '../../core/context/request-context'
import { AppError } from '../../core/http/app-error'
import { REDIS } from '../../core/redis/redis.provider'
import { RateLimitService } from '../../core/security/rate-limit.service'
import { IDENTITY_OPTIONS, type IdentityOptions } from './identity.options'
import { JwtService } from './jwt.service'
import { PasswordService } from './password.service'
import { SecurityEventsService } from './security-events.service'
import { SessionService } from './session.service'
import { generateBackupCodes, generateTotpSecret, otpauthUri, verifyTotp } from './totp'

export type SessionTokens = {
  accessToken: string
  refreshToken: string
  csrfToken: string
  /** Absolute end (12 h from sign-in) and idle end (last activity + 3 h). */
  expiresAt: Date
  idleExpiresAt: Date
  accessExpiresAt: Date
}

/** The access token never outlives either session deadline. */
function accessUntil(s: { expiresAt: Date; idleExpiresAt: Date }) {
  return new Date(
    Math.min(
      Date.now() + ACCESS_TTL_SECONDS * 1000,
      s.expiresAt.getTime(),
      s.idleExpiresAt.getTime(),
    ),
  )
}
export type AuthOutcome = { result: LoginResult; tokens?: SessionTokens }

type UserRow = {
  id: string
  email: string
  name: string
  emailVerifiedAt: Date | null
  timezone: string
  locale: string
  createdAt: Date
  twoFactor?: { enabledAt: Date | null } | null
}

export function toUserDto(user: UserRow): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerifiedAt !== null,
    twoFactorEnabled: Boolean(user.twoFactor?.enabledAt),
    timezone: user.timezone,
    locale: user.locale,
    createdAt: user.createdAt.toISOString(),
  }
}

const invalidCredentials = () =>
  new AppError('INVALID_CREDENTIALS', 401, 'Email or password is incorrect.')
const tokenInvalid = () =>
  new AppError('TOKEN_INVALID', 400, 'This link is invalid or has expired. Request a new one.')

@Injectable()
export class IdentityService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(REDIS) private readonly redis: IORedis,
    @Inject(IDENTITY_OPTIONS) private readonly options: IdentityOptions,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtService,
    private readonly sessions: SessionService,
    private readonly events: SecurityEventsService,
    private readonly limits: RateLimitService,
  ) {}

  // ------------------------------------------------------------------ registration & email

  async register(input: { name: string; email: string; password: string }): Promise<AuthOutcome> {
    const ip = requestContext.get()?.ip ?? 'unknown'
    await this.limits.consume([
      { bucket: 'register:ip', key: ip, limit: 5, windowSeconds: 3600 },
      { bucket: 'register:email', key: input.email, limit: 3, windowSeconds: 3600 },
    ])
    this.assertPasswordAllowed(input.password)
    const passwordHash = await this.passwords.hash(input.password)
    const userId = uuidv7()
    try {
      await this.db.withGlobal(async (tx) => {
        await tx.user.create({
          data: { id: userId, email: input.email, name: input.name, passwordHash },
        })
        await this.db.system.emitPlatformEvent(
          'identity.email_verification.requested',
          { userId },
          requestContext.correlationId() ?? null,
          tx,
        )
      })
    } catch (err) {
      if (isUniqueViolation(err))
        throw new AppError(
          'EMAIL_TAKEN',
          409,
          'An account with this email already exists. Sign in instead.',
        )
      throw err
    }
    const tokens = await this.startSession(userId)
    return { result: { status: 'AUTHENTICATED', csrfToken: tokens.csrfToken }, tokens }
  }

  async resendVerification(userId: string): Promise<void> {
    await this.limits.consume([
      { bucket: 'verify-resend:user', key: userId, limit: 3, windowSeconds: 3600 },
    ])
    await this.db.withGlobal(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } })
      if (user.emailVerifiedAt) return
      await this.db.system.emitPlatformEvent(
        'identity.email_verification.requested',
        { userId },
        requestContext.correlationId() ?? null,
        tx,
      )
    })
  }

  async verifyEmail(token: string): Promise<void> {
    await this.db.withGlobal(async (tx) => {
      const row = await tx.emailVerificationToken.findUnique({
        where: { tokenHash: sha256(token) },
      })
      if (!row || row.usedAt || row.expiresAt <= new Date()) throw tokenInvalid()
      await tx.emailVerificationToken.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      })
      const user = await tx.user.findUniqueOrThrow({ where: { id: row.userId } })
      if (!user.emailVerifiedAt) {
        await tx.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } })
        await this.events.record(row.userId, 'EMAIL_VERIFIED', undefined, tx)
      }
    })
  }

  // ------------------------------------------------------------------ login, 2FA, refresh, logout

  async login(email: string, password: string): Promise<AuthOutcome> {
    const ip = requestContext.get()?.ip ?? 'unknown'
    await this.limits.consume([
      { bucket: 'login:email', key: email, limit: 5, windowSeconds: 60 },
      { bucket: 'login:ip', key: ip, limit: 20, windowSeconds: 60 },
    ])
    const user = await this.db.withGlobal((tx) =>
      tx.user.findUnique({ where: { email }, include: { twoFactor: true } }),
    )
    const ok = await this.passwords.verify(user?.passwordHash, password)
    if (!user || !ok || user.disabledAt) {
      if (user) await this.events.record(user.id, 'LOGIN_FAILED')
      throw invalidCredentials()
    }
    if (user.twoFactor?.enabledAt) {
      const jti = uuidv7()
      return {
        result: { status: 'TOTP_REQUIRED', challengeToken: this.jwt.signChallenge(user.id, jti) },
      }
    }
    return this.completeLogin(user.id)
  }

  async verifyTwoFactor(challengeToken: string, code: string): Promise<AuthOutcome> {
    const claims = this.jwt.verifyChallenge(challengeToken)
    if (!claims)
      throw new AppError('TOKEN_INVALID', 401, 'This sign-in attempt expired. Sign in again.')
    const attempts = await this.redis.incr(`mfa_attempts:${claims.jti}`)
    await this.redis.expire(`mfa_attempts:${claims.jti}`, 600)
    if (attempts > 5)
      throw new AppError('RATE_LIMITED', 429, 'Too many attempts. Sign in again.', {
        retryAfter: 300,
      })
    if ((await this.redis.exists(`mfa_used:${claims.jti}`)) === 1)
      throw new AppError('TOKEN_INVALID', 401, 'This sign-in attempt was already used.')

    const valid = await this.checkSecondFactor(claims.sub, code)
    if (!valid) throw new AppError('INVALID_CODE', 401, 'That code is not valid.')
    await this.redis.set(`mfa_used:${claims.jti}`, '1', 'EX', 600)
    return this.completeLogin(claims.sub)
  }

  async refresh(refreshToken: string | undefined, active = false): Promise<SessionTokens> {
    if (!refreshToken) throw new AppError('UNAUTHENTICATED', 401, 'Please sign in.')
    const rotated = await this.sessions.rotate(refreshToken, active)
    if (!rotated.ok)
      throw new AppError('SESSION_EXPIRED', 401, 'Your session has ended. Please sign in again.')
    const accessExpiresAt = accessUntil(rotated)
    return {
      accessToken: this.jwt.signAccess(
        rotated.userId,
        rotated.familyId,
        undefined,
        accessExpiresAt,
      ),
      refreshToken: rotated.refreshToken,
      csrfToken: randomToken(),
      expiresAt: rotated.expiresAt,
      idleExpiresAt: rotated.idleExpiresAt,
      accessExpiresAt,
    }
  }

  async logout(userId: string, sessionId: string): Promise<void> {
    await this.sessions.revokeFamily(userId, sessionId, 'LOGOUT')
    await this.events.record(userId, 'LOGOUT')
  }

  // ------------------------------------------------------------------ passwords

  async requestPasswordReset(email: string): Promise<void> {
    const ip = requestContext.get()?.ip ?? 'unknown'
    await this.limits.consume([
      { bucket: 'forgot:ip', key: ip, limit: 5, windowSeconds: 3600 },
      { bucket: 'forgot:email', key: email, limit: 3, windowSeconds: 3600 },
    ])
    // Same response whether or not the account exists (no enumeration).
    await this.db.withGlobal(async (tx) => {
      const user = await tx.user.findUnique({ where: { email } })
      if (!user || user.disabledAt) return
      await this.db.system.emitPlatformEvent(
        'identity.password_reset.requested',
        { userId: user.id },
        requestContext.correlationId() ?? null,
        tx,
      )
    })
  }

  async resetPassword(token: string, password: string): Promise<void> {
    this.assertPasswordAllowed(password)
    const passwordHash = await this.passwords.hash(password)
    await this.db.withGlobal(async (tx) => {
      const row = await tx.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } })
      if (!row || row.usedAt || row.expiresAt <= new Date()) throw tokenInvalid()
      await tx.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } })
      const user = await tx.user.findUniqueOrThrow({ where: { id: row.userId } })
      // Receiving the link proves control of the mailbox, so the email counts as verified too.
      await tx.user.update({
        where: { id: row.userId },
        data: { passwordHash, emailVerifiedAt: user.emailVerifiedAt ?? new Date() },
      })
      await this.sessions.revokeAll(row.userId, 'PASSWORD_RESET', undefined, tx)
      await this.events.record(row.userId, 'PASSWORD_RESET', undefined, tx)
    })
  }

  async changePassword(
    userId: string,
    sessionId: string,
    current: string,
    next: string,
  ): Promise<void> {
    await this.limits.consume([
      { bucket: 'password-change:user', key: userId, limit: 5, windowSeconds: 900 },
    ])
    const user = await this.db.withGlobal((tx) =>
      tx.user.findUniqueOrThrow({ where: { id: userId } }),
    )
    if (!(await this.passwords.verify(user.passwordHash, current))) {
      throw new AppError('INVALID_CREDENTIALS', 401, 'Your current password is incorrect.')
    }
    this.assertPasswordAllowed(next)
    const passwordHash = await this.passwords.hash(next)
    await this.db.withGlobal(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash } })
      await this.sessions.revokeAll(userId, 'PASSWORD_CHANGED', sessionId, tx)
      await this.events.record(userId, 'PASSWORD_CHANGED', undefined, tx)
    })
  }

  // ------------------------------------------------------------------ profile

  async getUser(userId: string): Promise<UserDto> {
    const user = await this.db.withGlobal((tx) =>
      tx.user.findUniqueOrThrow({ where: { id: userId }, include: { twoFactor: true } }),
    )
    return toUserDto(user)
  }

  async updateProfile(
    userId: string,
    input: { name?: string; timezone?: string; locale?: string },
  ): Promise<UserDto> {
    const user = await this.db.withGlobal((tx) =>
      tx.user.update({ where: { id: userId }, data: input, include: { twoFactor: true } }),
    )
    return toUserDto(user)
  }

  // ------------------------------------------------------------------ two-factor

  async setupTwoFactor(userId: string): Promise<{ secret: string; otpauthUri: string }> {
    return this.db.withGlobal(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        include: { twoFactor: true },
      })
      if (user.twoFactor?.enabledAt)
        throw new AppError('CONFLICT', 409, 'Two-factor authentication is already on.')
      const secret = generateTotpSecret()
      const secretCiphertext = encryptSecret(this.options.keyRing, secret)
      await tx.twoFactorCredential.upsert({
        where: { userId },
        create: { userId, secretCiphertext, backupCodeHashes: [] },
        update: { secretCiphertext, backupCodeHashes: [], enabledAt: null },
      })
      return { secret, otpauthUri: otpauthUri(secret, user.email) }
    })
  }

  async enableTwoFactor(userId: string, code: string): Promise<string[]> {
    const cred = await this.db.withGlobal((tx) =>
      tx.twoFactorCredential.findUnique({ where: { userId } }),
    )
    if (!cred) throw new AppError('CONFLICT', 409, 'Start two-factor setup first.')
    if (cred.enabledAt)
      throw new AppError('CONFLICT', 409, 'Two-factor authentication is already on.')
    const secret = decryptSecret(this.options.keyRing, cred.secretCiphertext)
    if (verifyTotp(secret, code) === null)
      throw new AppError(
        'INVALID_CODE',
        400,
        'That code is not valid. Check the time on your device.',
      )
    const backupCodes = generateBackupCodes()
    const backupCodeHashes = await Promise.all(backupCodes.map((c) => this.passwords.hash(c)))
    await this.db.withGlobal(async (tx) => {
      await tx.twoFactorCredential.update({
        where: { userId },
        data: { enabledAt: new Date(), backupCodeHashes },
      })
      await this.events.record(userId, 'TWO_FACTOR_ENABLED', undefined, tx)
    })
    return backupCodes
  }

  async disableTwoFactor(userId: string, password: string, code: string): Promise<void> {
    const grant = await this.db.withGlobal((tx) =>
      tx.platformGrant.findUnique({ where: { userId } }),
    )
    if (grant && !grant.revokedAt)
      throw new AppError(
        'FORBIDDEN',
        403,
        'Revoke platform authorization before recovering or disabling two-factor authentication.',
      )
    const user = await this.db.withGlobal((tx) =>
      tx.user.findUniqueOrThrow({ where: { id: userId } }),
    )
    if (!(await this.passwords.verify(user.passwordHash, password)))
      throw new AppError('INVALID_CREDENTIALS', 401, 'Your password is incorrect.')
    if (!(await this.checkSecondFactor(userId, code)))
      throw new AppError('INVALID_CODE', 400, 'That code is not valid.')
    await this.db.withGlobal(async (tx) => {
      await tx.twoFactorCredential.delete({ where: { userId } })
      await this.events.record(userId, 'TWO_FACTOR_DISABLED', undefined, tx)
    })
  }

  // ------------------------------------------------------------------ used by tenancy (invitations)

  findUserByEmail(email: string, tx?: TenantTx) {
    const run = (t: TenantTx) => t.user.findUnique({ where: { email } })
    return tx ? run(tx) : this.db.withGlobal(run)
  }

  /** New account from an invitation link: the email is proven by the token, so it starts verified. */
  async createVerifiedUser(
    input: { email: string; name: string; password: string },
    tx: TenantTx,
  ): Promise<string> {
    this.assertPasswordAllowed(input.password)
    const passwordHash = await this.passwords.hash(input.password)
    const user = await tx.user.create({
      data: { email: input.email, name: input.name, passwordHash, emailVerifiedAt: new Date() },
    })
    return user.id
  }

  /** GET /auth/me: the current family's deadlines for the web inactivity warning. */
  sessionDeadlines(familyId: string) {
    return this.sessions.deadlines(familyId)
  }

  async startSession(userId: string, tx?: TenantTx): Promise<SessionTokens> {
    const issued = await this.sessions.issue(userId, tx)
    const accessExpiresAt = accessUntil(issued)
    return {
      accessToken: this.jwt.signAccess(userId, issued.familyId, undefined, accessExpiresAt),
      refreshToken: issued.refreshToken,
      csrfToken: randomToken(),
      expiresAt: issued.expiresAt,
      idleExpiresAt: issued.idleExpiresAt,
      accessExpiresAt,
    }
  }

  // ------------------------------------------------------------------ internals

  private async completeLogin(userId: string): Promise<AuthOutcome> {
    const tokens = await this.startSession(userId)
    await this.db.withGlobal(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } })
      await this.events.record(userId, 'LOGIN_SUCCEEDED', undefined, tx)
    })
    return { result: { status: 'AUTHENTICATED', csrfToken: tokens.csrfToken }, tokens }
  }

  /** TOTP (single use per time step) or a backup code (consumed on use). */
  private async checkSecondFactor(userId: string, code: string): Promise<boolean> {
    const cred = await this.db.withGlobal((tx) =>
      tx.twoFactorCredential.findUnique({ where: { userId } }),
    )
    if (!cred?.enabledAt) return false
    if (/^\d{6}$/.test(code)) {
      const step = verifyTotp(decryptSecret(this.options.keyRing, cred.secretCiphertext), code)
      if (step === null) return false
      const fresh = await this.redis.set(`totp_used:${userId}:${step}`, '1', 'EX', 120, 'NX')
      return fresh === 'OK'
    }
    const normalized = code.trim().toLowerCase()
    for (const [index, hash] of cred.backupCodeHashes.entries()) {
      if (await this.passwords.verify(hash, normalized)) {
        const remaining = cred.backupCodeHashes.filter((_, i) => i !== index)
        await this.db.withGlobal(async (tx) => {
          await tx.twoFactorCredential.update({
            where: { userId },
            data: { backupCodeHashes: remaining },
          })
          await this.events.record(userId, 'BACKUP_CODE_USED', { remaining: remaining.length }, tx)
        })
        return true
      }
    }
    return false
  }

  private assertPasswordAllowed(password: string): void {
    if (this.passwords.isBreached(password)) {
      throw AppError.validation(
        [
          {
            path: 'password',
            code: 'breached',
            message: 'This password appears in known data breaches. Choose another.',
          },
        ],
        'Choose a different password.',
      )
    }
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002'
}

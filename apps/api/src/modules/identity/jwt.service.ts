import { Inject, Injectable } from '@nestjs/common'
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  sign,
  verify,
} from 'node:crypto'
import { ACCESS_TTL_SECONDS } from '../../core/security/cookies'
import { IDENTITY_OPTIONS, type IdentityOptions } from './identity.options'

export type AccessClaims = { sub: string; sid: string; iat: number; exp: number }
export type ChallengeClaims = { sub: string; purpose: 'mfa'; jti: string; iat: number; exp: number }

const b64url = (value: Buffer | string) => Buffer.from(value).toString('base64url')
const HEADER = b64url(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' }))

/**
 * Minimal EdDSA (Ed25519) JWTs on node:crypto — no dependency, one algorithm, no `alg` confusion:
 * the header is fixed and never read back. Access tokens carry no tenant or role (docs/SECURITY.md).
 */
@Injectable()
export class JwtService {
  private readonly privateKey: KeyObject
  private readonly publicKey: KeyObject

  constructor(@Inject(IDENTITY_OPTIONS) options: IdentityOptions) {
    if (options.jwtPrivateKey && options.jwtPublicKey) {
      this.privateKey = createPrivateKey(Buffer.from(options.jwtPrivateKey, 'base64'))
      this.publicKey = createPublicKey(Buffer.from(options.jwtPublicKey, 'base64'))
    } else {
      // Development/test only (the env schema requires keys in production). Access tokens expire in
      // 15 minutes and refresh tokens are database-backed, so a restart only forces a silent refresh.
      const pair = generateKeyPairSync('ed25519')
      this.privateKey = pair.privateKey
      this.publicKey = pair.publicKey
    }
    if (this.privateKey.asymmetricKeyType !== 'ed25519') throw new Error('JWT keys must be Ed25519')
  }

  signAccess(userId: string, sessionId: string, now = Math.floor(Date.now() / 1000)): string {
    return this.sign({ sub: userId, sid: sessionId, iat: now, exp: now + ACCESS_TTL_SECONDS })
  }

  signChallenge(userId: string, jti: string, now = Math.floor(Date.now() / 1000)): string {
    return this.sign({ sub: userId, purpose: 'mfa', jti, iat: now, exp: now + 5 * 60 })
  }

  verifyAccess(token: string): AccessClaims | null {
    const claims = this.verify(token)
    return claims &&
      typeof claims.sub === 'string' &&
      typeof claims.sid === 'string' &&
      !('purpose' in claims)
      ? (claims as AccessClaims)
      : null
  }

  verifyChallenge(token: string): ChallengeClaims | null {
    const claims = this.verify(token)
    return claims &&
      claims.purpose === 'mfa' &&
      typeof claims.sub === 'string' &&
      typeof claims.jti === 'string'
      ? (claims as ChallengeClaims)
      : null
  }

  private sign(claims: Record<string, unknown>): string {
    const payload = b64url(JSON.stringify(claims))
    const signature = sign(null, Buffer.from(`${HEADER}.${payload}`), this.privateKey)
    return `${HEADER}.${payload}.${b64url(signature)}`
  }

  private verify(token: string): Record<string, unknown> | null {
    const parts = token.split('.')
    if (parts.length !== 3 || parts[0] !== HEADER) return null
    const [header, payload, signature] = parts as [string, string, string]
    const ok = verify(
      null,
      Buffer.from(`${header}.${payload}`),
      this.publicKey,
      Buffer.from(signature, 'base64url'),
    )
    if (!ok) return null
    try {
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
        string,
        unknown
      >
      if (typeof claims.exp !== 'number' || claims.exp <= Math.floor(Date.now() / 1000)) return null
      return claims
    } catch {
      return null
    }
  }
}

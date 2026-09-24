import { Algorithm, hash, verify } from '@node-rs/argon2'
import { Injectable, type OnModuleInit } from '@nestjs/common'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

/** OWASP baseline for Argon2id (docs/SECURITY.md → Passwords). Parameters live in each hash string. */
const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
}

@Injectable()
export class PasswordService implements OnModuleInit {
  private breached = new Set<string>()
  /** Verified against for unknown emails so login time doesn't reveal whether an account exists. */
  private dummyHash = ''

  async onModuleInit(): Promise<void> {
    // NCSC top-100k, filtered to entries that could pass the 10-char minimum (bundled, offline).
    const raw = gunzipSync(
      readFileSync(join(__dirname, 'data', 'breached-passwords.txt.gz')),
    ).toString('utf8')
    this.breached = new Set(raw.split('\n').filter(Boolean))
    this.dummyHash = await hash('dummy-password-for-timing', ARGON2_OPTIONS)
  }

  isBreached(password: string): boolean {
    return this.breached.has(password.toLowerCase())
  }

  hash(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS)
  }

  async verify(passwordHash: string | null | undefined, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash ?? this.dummyHash, password)
    } catch {
      return false
    }
  }
}

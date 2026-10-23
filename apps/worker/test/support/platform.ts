import {
  IDENTITY_OPTIONS,
  type IdentityOptions,
  PasswordService,
  totpAt,
} from '@fenwira/api/modules/identity'
import { encryptSecret, uuidv7 } from '@fenwira/config'
import { type Database } from '@fenwira/database'
import { type INestApplication } from '@nestjs/common'
import { Client, PASSWORD, uniqueEmail } from './harness'

/**
 * A verified, 2FA-enrolled platform operator with a fresh MFA platform session (the grant is
 * written with the migration role, like the real `platform:operator` tool). Returns a client whose
 * cookies and CSRF token reach /api/v1/platform.
 */
export async function createOperator(
  api: INestApplication,
  db: Database,
  migration: Database,
  label = 'operator',
): Promise<{ client: Client; operatorId: string }> {
  const operatorId = uuidv7()
  const email = uniqueEmail(label)
  const secret = 'JBSWY3DPEHPK3PXP'
  const options = api.get<IdentityOptions>(IDENTITY_OPTIONS)
  await db.withGlobal(async (tx) => {
    await tx.user.create({
      data: {
        id: operatorId,
        email,
        name: `${label} person`,
        emailVerifiedAt: new Date(),
        passwordHash: await api.get(PasswordService).hash(PASSWORD),
      },
    })
    await tx.twoFactorCredential.create({
      data: {
        userId: operatorId,
        secretCiphertext: encryptSecret(options.keyRing, secret),
        enabledAt: new Date(),
      },
    })
  })
  await migration.withGlobal((tx) =>
    tx.platformGrant.create({
      data: { userId: operatorId, reason: 'isolated test fixture', grantedBy: 'test' },
    }),
  )
  const client = new Client(api)
  const login = await client.post('/platform/auth/login', { email, password: PASSWORD })
  if (login.status !== 200) throw new Error(`platform login ${login.status} ${login.text}`)
  const verified = await client.post('/platform/auth/verify', {
    challengeToken: login.body.data.challengeToken,
    code: totpAt(secret, Math.floor(Date.now() / 30_000)),
  })
  if (verified.status !== 200)
    throw new Error(`platform verify ${verified.status} ${verified.text}`)
  client.csrf = verified.body.data.csrfToken
  return { client, operatorId }
}

import { uuidv7 } from '@fenwira/config'
import { Client } from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { Database } from '../src'

let db: Database
let owner: Client
const operator = uuidv7()
beforeAll(async () => {
  db = Database.connect({ url: process.env.DATABASE_URL! })
  owner = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL! })
  await owner.connect()
  await db.withGlobal((tx) =>
    tx.user.create({
      data: {
        id: operator,
        email: `${operator}@platform.test`,
        name: 'Operator',
        passwordHash: 'unused',
      },
    }),
  )
})
afterAll(async () => {
  await db.disconnect()
  await owner.end()
})
it('runtime cannot grant operator authorization; absence and revocation fail closed', async () => {
  await expect(
    db.withGlobal((tx) =>
      tx.platformGrant.create({ data: { userId: operator, reason: 'test', grantedBy: 'test' } }),
    ),
  ).rejects.toThrow(/permission denied/i)
  await expect(db.withPlatform(operator, async () => true)).rejects.toThrow(
    'Platform access denied',
  )
  await owner.query(
    "INSERT INTO platform_grants(user_id, reason, granted_by) VALUES ($1,'test','test')",
    [operator],
  )
  await expect(db.withPlatform(operator, async () => true)).resolves.toBe(true)
  await owner.query('UPDATE platform_grants SET revoked_at = now() WHERE user_id = $1', [operator])
  await expect(db.withPlatform(operator, async () => true)).rejects.toThrow(
    'Platform access denied',
  )
})
it('platform audit is append-only and invisible without platform context', async () => {
  await owner.query('UPDATE platform_grants SET revoked_at = NULL WHERE user_id = $1', [operator])
  const id = uuidv7()
  await db.withGlobal((tx) =>
    tx.platformAudit.createMany({
      data: { id, operatorId: operator, action: 'test', outcome: 'SUCCESS' },
    }),
  )
  expect(await db.withGlobal((tx) => tx.platformAudit.findUnique({ where: { id } }))).toBeNull()
  expect(
    await db.withPlatform(operator, (tx) => tx.platformAudit.findUnique({ where: { id } })),
  ).not.toBeNull()
  await expect(
    db.withPlatform(operator, (tx) => tx.platformAudit.delete({ where: { id } })),
  ).rejects.toThrow(/permission denied/i)
  await expect(
    db.withPlatform(operator, (tx) =>
      tx.platformAudit.update({ where: { id }, data: { outcome: 'changed' } }),
    ),
  ).rejects.toThrow(/permission denied/i)
})

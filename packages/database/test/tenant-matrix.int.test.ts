import { uuidv7 } from '@fenwira/config'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Database, type TenantTx } from '../src'

/**
 * Generated cross-tenant matrix (docs/prompts/PHASE_03 → Mandatory security tests).
 * Every public table with a tenant_id column MUST have a fixture here; the first test fails when a
 * new tenant table appears without one, so coverage can't silently lag behind the schema.
 */
type Fixture = (tx: TenantTx, ctx: { tenantId: string; userId: string }) => Promise<unknown>

const FIXTURES: Record<string, Fixture> = {
  outbox_events: (tx, { tenantId }) =>
    tx.outboxEvent.create({ data: { tenantId, eventType: 'test.event', payload: {} } }),
  memberships: (tx, { tenantId, userId }) =>
    tx.membership.create({ data: { tenantId, userId, role: 'VIEWER' } }),
  invitations: (tx, { tenantId, userId }) =>
    tx.invitation.create({
      data: { tenantId, email: `${uuidv7()}@matrix.test`, role: 'AGENT', invitedById: userId },
    }),
  audit_logs: (tx, { tenantId }) =>
    tx.auditLog.create({
      data: { tenantId, actorType: 'SYSTEM', action: 'test.action', targetType: 'test' },
    }),
}

const APPEND_ONLY = new Set(['audit_logs'])

const appUrl = process.env.DATABASE_URL!
const ownerUrl = process.env.MIGRATION_DATABASE_URL!
let db: Database
let owner: Client
let tenantTables: string[]
const A = { tenantId: uuidv7(), userId: uuidv7() }
const B = { tenantId: uuidv7(), userId: uuidv7() }

async function seedTenant(t: { tenantId: string; userId: string }, name: string) {
  await db.withGlobal((tx) =>
    tx.user.create({
      data: { id: t.userId, email: `${t.userId}@matrix.test`, name, passwordHash: 'x' },
    }),
  )
  await db.withTenant(t.tenantId, async (tx) => {
    await tx.tenant.create({
      data: { id: t.tenantId, name, slug: `matrix-${t.tenantId}`, ownerUserId: t.userId },
    })
    await tx.membership.create({ data: { tenantId: t.tenantId, userId: t.userId, role: 'OWNER' } })
    for (const [table, fixture] of Object.entries(FIXTURES)) {
      if (table === 'memberships') continue // the OWNER row above is this tenant's membership fixture
      await fixture(tx, t)
    }
  })
}

beforeAll(async () => {
  db = Database.connect({ url: appUrl, poolSize: 4 })
  owner = new Client({ connectionString: ownerUrl })
  await owner.connect()
  const { rows } = await owner.query<{ table: string }>(`
    SELECT c.relname AS table FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY 1`)
  tenantTables = rows.map((r) => r.table)
  await seedTenant(A, 'Tenant A')
  await seedTenant(B, 'Tenant B')
})

afterAll(async () => {
  await db?.disconnect()
  await owner?.end()
})

describe('coverage', () => {
  it('has a fixture for every tenant-owned table in the schema', () => {
    expect(tenantTables.sort()).toEqual(Object.keys(FIXTURES).sort())
  })
})

describe.each(Object.keys(FIXTURES))('%s', (table) => {
  const bound = <T>(fn: (tx: TenantTx) => Promise<T>) =>
    db.withTenant(A.tenantId, fn, { userId: A.userId })

  it('Tenant A cannot read Tenant B rows', async () => {
    const rows = await bound((tx) =>
      tx.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM ${table} WHERE tenant_id = $1::uuid`,
        B.tenantId,
      ),
    )
    expect(Number(rows[0]!.n)).toBe(0)
    const own = await bound((tx) =>
      tx.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM ${table} WHERE tenant_id = $1::uuid`,
        A.tenantId,
      ),
    )
    expect(Number(own[0]!.n)).toBeGreaterThan(0)
  })

  it('Tenant A cannot update or delete Tenant B rows', async () => {
    const update = () =>
      bound((tx) =>
        tx.$executeRawUnsafe(
          `UPDATE ${table} SET tenant_id = tenant_id WHERE tenant_id = $1::uuid`,
          B.tenantId,
        ),
      )
    const remove = () =>
      bound((tx) =>
        tx.$executeRawUnsafe(`DELETE FROM ${table} WHERE tenant_id = $1::uuid`, B.tenantId),
      )
    if (APPEND_ONLY.has(table)) {
      // Append-only: the runtime role can't update or delete at all, in any tenant.
      await expect(update()).rejects.toThrow(/permission denied/)
      await expect(remove()).rejects.toThrow(/permission denied/)
    } else {
      expect(await update()).toBe(0)
      expect(await remove()).toBe(0)
    }
    const stillThere = await db.withTenant(B.tenantId, (tx) =>
      tx.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM ${table}`),
    )
    expect(Number(stillThere[0]!.n)).toBeGreaterThan(0)
  })

  it('Tenant A cannot write a row labelled with Tenant B (WITH CHECK)', async () => {
    await expect(
      bound((tx) => FIXTURES[table]!(tx, { tenantId: B.tenantId, userId: A.userId })),
    ).rejects.toThrow(/row-level security/)
  })

  it('no bound tenant sees zero rows', async () => {
    const rows = await db.withGlobal((tx) =>
      tx.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM ${table}`),
    )
    expect(Number(rows[0]!.n)).toBe(0)
  })
})

describe('tenant root and memberships', () => {
  it('a user lists only their own tenants and memberships before choosing one', async () => {
    const seen = await db.withUser(A.userId, async (tx) => ({
      tenants: (await tx.tenant.findMany()).map((t) => t.id),
      memberships: (await tx.membership.findMany()).map((m) => m.tenantId),
    }))
    expect(seen).toEqual({ tenants: [A.tenantId], memberships: [A.tenantId] })
  })

  it('membership never grants writes to another tenant row', async () => {
    const updated = await db.withTenant(
      B.tenantId,
      (tx) => tx.tenant.updateMany({ where: { id: A.tenantId }, data: { name: 'hijacked' } }),
      {
        userId: A.userId,
      },
    )
    expect(updated.count).toBe(0)
  })

  it('allows exactly one active OWNER per tenant', async () => {
    const other = uuidv7()
    await db.withGlobal((tx) =>
      tx.user.create({
        data: { id: other, email: `${other}@matrix.test`, name: 'x', passwordHash: 'x' },
      }),
    )
    await expect(
      db.withTenant(A.tenantId, (tx) =>
        tx.membership.create({ data: { tenantId: A.tenantId, userId: other, role: 'OWNER' } }),
      ),
    ).rejects.toThrow(/Unique constraint|unique/i)
  })

  it('audit logs are append-only for the runtime role', async () => {
    await expect(
      db.withTenant(A.tenantId, (tx) => tx.auditLog.updateMany({ data: { action: 'tampered' } })),
    ).rejects.toThrow(/permission denied/)
    await expect(db.withTenant(A.tenantId, (tx) => tx.auditLog.deleteMany())).rejects.toThrow(
      /permission denied/,
    )
  })

  it('role and permission catalogs are seeded and read-only', async () => {
    const roles = await db.withGlobal((tx) => tx.role.findMany({ orderBy: { rank: 'desc' } }))
    expect(roles.map((r) => r.key)).toEqual(['OWNER', 'ADMIN', 'MANAGER', 'AGENT', 'VIEWER'])
    await expect(
      db.withGlobal((tx) => tx.role.update({ where: { key: 'VIEWER' }, data: { rank: 99 } })),
    ).rejects.toThrow(/permission denied/)
  })
})

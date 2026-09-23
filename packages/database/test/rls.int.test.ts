import { uuidv7 } from '@fenwira/config'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Database, findRlsViolations } from '../src'

// Runs against a migrated database: DATABASE_URL = fenwira_app, MIGRATION_DATABASE_URL = owner.
const appUrl = process.env.DATABASE_URL!
const ownerUrl = process.env.MIGRATION_DATABASE_URL!

const tenantA = uuidv7()
const tenantB = uuidv7()

let db: Database
let owner: Client
let rawApp: Client

async function insertTenantEvent(tenantId: string, rowTenantId = tenantId): Promise<void> {
  await db.withTenant(tenantId, (tx) =>
    tx.outboxEvent.create({
      data: { tenantId: rowTenantId, eventType: 'test.event', payload: { n: 1 } },
    }),
  )
}

beforeAll(async () => {
  expect(appUrl, 'DATABASE_URL must be set').toBeTruthy()
  expect(ownerUrl, 'MIGRATION_DATABASE_URL must be set').toBeTruthy()
  db = Database.connect({ url: appUrl, poolSize: 4 })
  owner = new Client({ connectionString: ownerUrl })
  rawApp = new Client({ connectionString: appUrl })
  await Promise.all([owner.connect(), rawApp.connect()])
})

beforeEach(async () => {
  // TRUNCATE is not subject to RLS; only the owner holds it.
  await owner.query('TRUNCATE outbox_events')
})

afterAll(async () => {
  await db?.disconnect()
  await owner?.end()
  await rawApp?.end()
})

describe('runtime role', () => {
  it('connects as fenwira_app, which cannot bypass RLS', async () => {
    const { rows } = await rawApp.query<{ user: string; super: boolean; bypass: boolean }>(
      `SELECT current_user AS user, rolsuper AS super, rolbypassrls AS bypass
         FROM pg_roles WHERE rolname = current_user`,
    )
    expect(rows[0]).toEqual({ user: 'fenwira_app', super: false, bypass: false })
  })

  it('cannot run DDL', async () => {
    await expect(rawApp.query('CREATE TABLE should_fail (id int)')).rejects.toThrow(
      /permission denied/,
    )
  })
})

describe('tenant isolation on outbox_events', () => {
  it('shows a tenant only its own rows', async () => {
    await insertTenantEvent(tenantA)
    await insertTenantEvent(tenantB)

    const seenByA = await db.withTenant(tenantA, (tx) => tx.outboxEvent.findMany())
    expect(seenByA).toHaveLength(1)
    expect(seenByA[0]!.tenantId).toBe(tenantA)

    const seenByB = await db.withTenant(tenantB, (tx) => tx.outboxEvent.findMany())
    expect(seenByB.map((e) => e.tenantId)).toEqual([tenantB])
  })

  it('fails closed with no tenant context bound', async () => {
    await insertTenantEvent(tenantA)
    const { rows } = await rawApp.query('SELECT * FROM outbox_events')
    expect(rows).toHaveLength(0)
  })

  it('fails closed after the setting is RESET within a session', async () => {
    await insertTenantEvent(tenantA)
    await rawApp.query('BEGIN')
    await rawApp.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenantA])
    await rawApp.query('RESET app.current_tenant_id')
    const { rows } = await rawApp.query('SELECT * FROM outbox_events')
    await rawApp.query('COMMIT')
    expect(rows).toHaveLength(0)
  })

  it('rejects writing a row for another tenant (WITH CHECK)', async () => {
    await expect(insertTenantEvent(tenantA, tenantB)).rejects.toThrow(/row-level security/)
  })

  it('cannot update or delete another tenant’s rows', async () => {
    await insertTenantEvent(tenantB)
    const updated = await db.withTenant(tenantA, (tx) =>
      tx.outboxEvent.updateMany({ data: { lastError: 'tampered' } }),
    )
    const deleted = await db.withTenant(tenantA, (tx) => tx.outboxEvent.deleteMany())
    expect(updated.count).toBe(0)
    expect(deleted.count).toBe(0)
    const stillThere = await db.withTenant(tenantB, (tx) => tx.outboxEvent.findMany())
    expect(stillThere).toHaveLength(1)
    expect(stillThere[0]!.lastError).toBeNull()
  })

  it('does not leak tenant context across pooled transactions', async () => {
    // One pooled connection guarantees the next transaction reuses the same session.
    const single = Database.connect({ url: appUrl, poolSize: 1 })
    try {
      await insertTenantEvent(tenantA)
      await single.withTenant(tenantA, (tx) => tx.outboxEvent.findMany())
      const leaked = await single.withUser(uuidv7(), async (tx) => {
        const rows = await tx.$queryRaw<Array<{ t: string | null }>>`
          SELECT current_setting('app.current_tenant_id', true) AS t`
        const visible = await tx.outboxEvent.count()
        return { setting: rows[0]!.t ?? '', visible }
      })
      expect(leaked).toEqual({ setting: '', visible: 0 })
    } finally {
      await single.disconnect()
    }
  })
})

describe('platform events via system.* functions', () => {
  it('cannot be inserted directly by the app role', async () => {
    // No tenant bound: tenant_id is NULL and WITH CHECK (NULL = NULL) is not true.
    await expect(
      rawApp.query(`INSERT INTO outbox_events (id, event_type, payload)
                    VALUES (gen_random_uuid(), 'system.ping.requested', '{}')`),
    ).rejects.toThrow(/row-level security/)
  })

  it('emits through system.emit_platform_event and is invisible to tenants', async () => {
    const id = await db.system.emitPlatformEvent('system.ping.requested', { a: 1 }, 'corr-1')
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(id[14]).toBe('7') // UUIDv7 from fenwira_uuid_v7()
    const seenByA = await db.withTenant(tenantA, (tx) => tx.outboxEvent.findMany())
    expect(seenByA).toHaveLength(0)
  })

  it('rejects malformed event types', async () => {
    await expect(db.system.emitPlatformEvent('DROP TABLE', {}, null)).rejects.toThrow(
      /invalid event type/,
    )
  })

  it('claims across tenants with a lease, then marks dispatched', async () => {
    await insertTenantEvent(tenantA)
    await db.system.emitPlatformEvent('system.ping.requested', {}, 'corr-2')

    const claimed = await db.system.claimOutboxEvents(10, 30)
    expect(claimed).toHaveLength(2)
    expect(claimed.every((e) => e.attempts === 1)).toBe(true)

    // Leased rows are not claimable again until the lease expires.
    expect(await db.system.claimOutboxEvents(10, 30)).toHaveLength(0)

    expect(await db.system.markOutboxDispatched(claimed.map((e) => e.id))).toBe(2)
    // Dispatching twice is a no-op.
    expect(await db.system.markOutboxDispatched(claimed.map((e) => e.id))).toBe(0)
  })

  it('schedules retries with backoff and fails after max attempts', async () => {
    await insertTenantEvent(tenantA)
    const [first] = await db.system.claimOutboxEvents(1, 30)
    expect(await db.system.markOutboxRetry(first!.id, 'redis down', 5)).toBe(1)
    let row = await db.withTenant(tenantA, (tx) =>
      tx.outboxEvent.findUniqueOrThrow({ where: { id: first!.id } }),
    )
    expect(row.status).toBe('PENDING')
    expect(row.lastError).toBe('redis down')
    expect(row.availableAt.getTime()).toBeGreaterThan(Date.now()) // backed off, not claimable yet

    expect(await db.system.markOutboxRetry(first!.id, 'still down', 1)).toBe(1) // attempts (1) >= max (1)
    row = await db.withTenant(tenantA, (tx) =>
      tx.outboxEvent.findUniqueOrThrow({ where: { id: first!.id } }),
    )
    expect(row.status).toBe('FAILED')
  })

  it('cannot call system functions it was not granted (no PUBLIC execute)', async () => {
    const { rows } = await owner.query<{ has: boolean }>(
      `SELECT has_function_privilege('public', 'system.claim_outbox_events(integer, integer)', 'EXECUTE') AS has`,
    )
    expect(rows[0]!.has).toBe(false)
  })
})

describe('RLS coverage check', () => {
  it('reports no violations on the migrated schema', async () => {
    expect(await findRlsViolations(owner)).toEqual([])
  })

  it('detects a tenant table without RLS', async () => {
    await owner.query('CREATE TABLE IF NOT EXISTS rls_probe (id int, tenant_id uuid)')
    try {
      const violations = await findRlsViolations(owner)
      expect(violations.map((v) => v.table)).toContain('rls_probe')
    } finally {
      await owner.query('DROP TABLE rls_probe')
    }
  })
})

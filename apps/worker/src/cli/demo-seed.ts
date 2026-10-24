import { UUID_RE } from '@fenwira/config'
import { Database } from '@fenwira/database'
import { seedDemoWorkspace } from '../demo/demo-seed'
import { cliArg } from './operator-http'

/** Operator-run: fills the internal workspace with [DEMO] data (refuses any other workspace). */
async function main() {
  const tenantId = cliArg('--tenant')
  if (!tenantId || !UUID_RE.test(tenantId)) throw new Error('Required: --tenant <uuid>')
  const DATABASE_URL = process.env.DATABASE_URL
  if (!DATABASE_URL) throw new Error('Required: DATABASE_URL (the runtime app role)')
  const db = Database.connect({ url: DATABASE_URL, poolSize: 1 })
  try {
    const r = await db.withTenant(tenantId, (tx) => seedDemoWorkspace(tx, tenantId), {
      timeoutMs: 60_000,
    })
    process.stdout.write(
      r.seeded
        ? `Seeded demo data: ${r.contacts} contacts, ${r.conversations} conversations, ${r.templates} templates, 1 draft campaign.\n`
        : 'Demo data already present; nothing changed.\n',
    )
  } finally {
    await db.disconnect()
  }
}
void main().catch((err: unknown) => {
  process.stderr.write(
    `Demo seed failed: ${err instanceof Error ? err.message : 'unknown error'}\n`,
  )
  process.exitCode = 1
})

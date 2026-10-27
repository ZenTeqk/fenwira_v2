import { UUID_RE } from '@fenwira/config'
import { Database } from '@fenwira/database'
import { backfillTemplateSnapshots } from '@fenwira/api/modules/templates'
import { cliArg } from './operator-http'

/**
 * One-off: rebuilds the template snapshot of TEMPLATE messages sent before snapshots existed
 * (docs/MESSAGING_ENGINE.md → Template snapshot). Idempotent and batched; safe to re-run or stop.
 * Unresolvable templates or values give a partial snapshot, never an error. Optional --tenant.
 */
async function main() {
  const tenantId = cliArg('--tenant')
  if (tenantId && !UUID_RE.test(tenantId)) throw new Error('--tenant must be a workspace id')
  const batch = Number(cliArg('--batch') ?? 200)
  if (!Number.isInteger(batch) || batch < 1 || batch > 1000)
    throw new Error('--batch must be 1–1000')
  const DATABASE_URL = process.env.DATABASE_URL
  if (!DATABASE_URL) throw new Error('Required: DATABASE_URL (the runtime app role)')
  const db = Database.connect({ url: DATABASE_URL, poolSize: 1 })
  try {
    const r = await backfillTemplateSnapshots(db, {
      ...(tenantId ? { tenantId } : {}),
      batchSize: batch,
    })
    process.stdout.write(
      `Template snapshots: ${r.messages} message(s) in ${r.tenants} workspace(s), ${r.partial} partial.\n`,
    )
  } finally {
    await db.disconnect()
  }
}
void main().catch((err: unknown) => {
  process.stderr.write(
    `Template snapshot backfill failed: ${err instanceof Error ? err.message : 'unknown error'}\n`,
  )
  process.exitCode = 1
})

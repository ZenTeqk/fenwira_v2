import { loadEnv, workerEnvSchema } from '@fenwira/config'
import { Database } from '@fenwira/database'

/**
 * Sets a tenant's billing mode (P9-D1; operators only until the Phase 11 admin UI).
 *   node dist/cli/billing-mode.js --tenant <tenantId> --mode FREE|TRIAL|PREPAID
 */
const MODES = ['FREE', 'TRIAL', 'PREPAID'] as const

async function main(): Promise<void> {
  const env = loadEnv(workerEnvSchema)
  const args = process.argv.slice(2)
  const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
  const tenantId = arg('--tenant')
  const mode = arg('--mode') as (typeof MODES)[number] | undefined
  if (!tenantId || !mode || !MODES.includes(mode)) {
    process.stderr.write('usage: billing-mode --tenant <tenantId> --mode FREE|TRIAL|PREPAID\n')
    process.exit(2)
  }
  const db = Database.connect({ url: env.DATABASE_URL, poolSize: 1 })
  try {
    await db.withTenant(tenantId, (tx) =>
      tx.tenant.update({ where: { id: tenantId }, data: { billingMode: mode } }),
    )
    process.stdout.write(`tenant ${tenantId} billing mode is now ${mode}\n`)
  } finally {
    await db.disconnect()
  }
}

void main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})

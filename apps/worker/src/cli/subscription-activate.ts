import { activatePlan } from '@fenwira/api/modules/billing'
import { loadEnv, workerEnvSchema } from '@fenwira/config'
import { Database } from '@fenwira/database'

/**
 * Activates or changes a workspace's plan (Phase 11 Step 4, P11-D24: OWNERs request, the Fenwira
 * team activates; the Platform Operator UI replaces this in Step 5). Effective immediately
 * (P11-D26); never deletes data; a shrinking analytics window keeps 30 days of grace (P11-D28).
 *   pnpm --filter @fenwira/worker subscription:activate -- --tenant <id> --plan GROWTH [--note text]
 */
async function main(): Promise<void> {
  const env = loadEnv(workerEnvSchema)
  const args = process.argv.slice(2)
  const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
  const tenantId = arg('--tenant')
  const plan = arg('--plan')
  if (!tenantId || !plan) {
    process.stderr.write(
      'usage: subscription:activate --tenant <tenantId> --plan <KEY> [--note text]\n',
    )
    process.exit(2)
  }
  const db = Database.connect({ url: env.DATABASE_URL, poolSize: 1 })
  try {
    const r = await db.withTenant(tenantId, (tx) =>
      activatePlan(
        tx,
        tenantId,
        plan,
        new Date(),
        { type: 'SYSTEM', note: arg('--note') ?? 'Activated by operator CLI' },
        env.BILLING_TRIAL_PLAN,
      ),
    )
    process.stdout.write(`${tenantId}: ${r.from ?? 'trial'} → ${r.to} (ACTIVE)\n`)
  } finally {
    await db.disconnect()
  }
}

void main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})

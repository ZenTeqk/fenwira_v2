import { billingPlatformFromEnv, postTransaction } from '@fenwira/api/modules/billing'
import { loadEnv, uuidv7, workerEnvSchema } from '@fenwira/config'
import { Database } from '@fenwira/database'

/**
 * Manual top-up (decision B2: payments and top-ups are manual operations in v2). Platform
 * operators only; appends a CREDIT to the tenant's append-only ledger.
 *   node dist/cli/wallet-credit.js --tenant <tenantId> --amount 500 [--reason "Invoice 42"]
 * `--amount` is in major units (₹500 → 50000 paise).
 */
async function main(): Promise<void> {
  const env = loadEnv(workerEnvSchema)
  const args = process.argv.slice(2)
  const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
  const tenantId = arg('--tenant')
  const amount = Number(arg('--amount'))
  if (!tenantId || !Number.isFinite(amount) || amount <= 0) {
    process.stderr.write(
      'usage: wallet-credit --tenant <tenantId> --amount <major units> [--reason text]\n',
    )
    process.exit(2)
  }
  const db = Database.connect({ url: env.DATABASE_URL, poolSize: 1 })
  try {
    const minor = BigInt(Math.round(amount * 100))
    await db.withTenant(tenantId, (tx) =>
      postTransaction(
        tx,
        tenantId,
        {
          type: 'CREDIT',
          amountMinor: minor,
          reason: arg('--reason') ?? 'Manual top-up',
          idempotencyKey: `manual-credit:${uuidv7()}`,
        },
        billingPlatformFromEnv(env),
      ),
    )
    const wallet = await db.withTenant(tenantId, (tx) =>
      tx.wallet.findUniqueOrThrow({ where: { tenantId } }),
    )
    process.stdout.write(`credited ${minor} (minor units); balance now ${wallet.balanceMinor}\n`)
  } finally {
    await db.disconnect()
  }
}

void main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})

import { UUID_RE } from '@fenwira/config'
import { Database } from '@fenwira/database'
import { seedDemoWorkspace } from '../demo/demo-seed'
import { cliArg } from './operator-http'

/**
 * Operator-run: fills Fenwira's internal workspace with [DEMO] data. Refuses any workspace that is
 * not internal or whose name differs from --name. Safe to re-run (only missing items are added).
 * --dry-run does all of it inside the transaction, reports, then rolls back (nothing is kept).
 */
class DryRun extends Error {
  constructor(readonly result: Awaited<ReturnType<typeof seedDemoWorkspace>>) {
    super('dry run')
  }
}
async function main() {
  const tenantId = cliArg('--tenant')
  const name = cliArg('--name')
  if (!tenantId || !UUID_RE.test(tenantId) || !name)
    throw new Error('Required: --tenant <uuid> --name "<exact workspace name>"')
  const DATABASE_URL = process.env.DATABASE_URL
  if (!DATABASE_URL) throw new Error('Required: DATABASE_URL (the runtime app role)')
  const dryRun = process.argv.includes('--dry-run')
  const db = Database.connect({ url: DATABASE_URL, poolSize: 1 })
  try {
    const r = await db
      .withTenant(
        tenantId,
        async (tx) => {
          const result = await seedDemoWorkspace(tx, tenantId, new Date(), name)
          if (dryRun) throw new DryRun(result)
          return result
        },
        { timeoutMs: 120_000 },
      )
      .catch((err: unknown) => {
        if (!(err instanceof DryRun)) throw err
        process.stdout.write('Dry run: rolled back, nothing was changed. It would have:\n')
        return err.result
      })
    process.stdout.write(
      r.seeded
        ? `Added demo data: ${r.contacts} contacts, ${r.conversations} conversations, ${r.templates} templates${r.campaign ? ', 1 draft campaign' : ''}${r.repaired ? `, ${r.repaired} demo templates repaired` : ''}.\n`
        : 'Demo data already complete; nothing changed.\n',
    )
  } finally {
    await db.disconnect()
  }
}
void main().catch((err: unknown) => {
  // First line only, credentials masked: Prisma messages can be long and quote the connection.
  const code = (err as { code?: unknown })?.code
  const message = (err instanceof Error ? err.message : 'unknown error')
    .split('\n')
    .find((l) => l.trim())
    ?.replace(/\b(postgres(?:ql)?):\/\/[^\s'"]+/gi, '$1://[MASKED]')
  process.stderr.write(
    `Demo seed failed${typeof code === 'string' ? ` (${code})` : ''}: ${message ?? 'unknown error'}\nNothing was changed (the seed runs in one transaction).\n`,
  )
  process.exitCode = 1
})

import { Client } from 'pg'
import { findRlsViolations } from '../rls'

async function main(): Promise<void> {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL
  if (!url) throw new Error('Set MIGRATION_DATABASE_URL or DATABASE_URL')
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    const violations = await findRlsViolations(client)
    for (const v of violations) console.error(`RLS violation: ${v.table}: ${v.problem}`)
    if (violations.length > 0) process.exit(1)
    console.log('RLS check passed')
  } finally {
    await client.end()
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})

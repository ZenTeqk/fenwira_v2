import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { loadEnv, migrateEnvSchema } from '@fenwira/config'
import { Client } from 'pg'
import { POST_MIGRATE_SQL_PATH, PRISMA_SCHEMA_PATH } from '../paths'
import { findRlsViolations } from '../rls'
import { seedPlans } from '../seed-plans'
import { seedRbac } from '../seed-rbac'

/**
 * `prisma migrate deploy` → post-migrate.sql → RLS check, as fenwira_owner.
 * Used by the fenwira-migrate compose one-shot, CI and the integration test runner.
 */
async function main(): Promise<void> {
  const env = loadEnv(migrateEnvSchema)

  const prismaCli = require.resolve('prisma/build/index.js')
  const result = spawnSync(
    process.execPath,
    [prismaCli, 'migrate', 'deploy', '--schema', PRISMA_SCHEMA_PATH],
    {
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: env.MIGRATION_DATABASE_URL },
    },
  )
  if (result.status !== 0) throw new Error(`prisma migrate deploy failed (exit ${result.status})`)

  const client = new Client({ connectionString: env.MIGRATION_DATABASE_URL })
  await client.connect()
  try {
    await client.query(readFileSync(POST_MIGRATE_SQL_PATH, 'utf8'))
    console.log('post-migrate.sql applied')

    const seeded = await seedRbac(client)
    console.log(
      `RBAC seeded: ${seeded.roles} roles, ${seeded.permissions} permissions, ${seeded.grants} grants`,
    )

    const plans = await seedPlans(client)
    console.log(`Plans seeded: ${plans.plans} (missing rows only)`)

    const violations = await findRlsViolations(client)
    if (violations.length > 0) {
      for (const v of violations) console.error(`RLS violation: ${v.table}: ${v.problem}`)
      throw new Error(`${violations.length} RLS violation(s)`)
    }
    console.log('RLS check passed')
  } finally {
    await client.end()
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})

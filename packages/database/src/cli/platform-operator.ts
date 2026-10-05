import { loadEnv, migrateEnvSchema, UUID_RE, uuidv7 } from '@fenwira/config'
import { Client } from 'pg'

/** Restricted bootstrap/break-glass tool. Never available via tenant HTTP. */
async function main() {
  const args = process.argv.slice(2)
  const arg = (key: string) => args[args.indexOf(key) + 1]
  const userId = arg('--user')
  const actor = arg('--actor')
  const reason = arg('--reason')
  if (
    !args.includes('--user') ||
    !userId ||
    !UUID_RE.test(userId) ||
    !args.includes('--actor') ||
    !actor ||
    !args.includes('--reason') ||
    !reason?.trim()
  )
    throw new Error(
      'usage: platform:operator --user <uuid> --actor <operator/reference> --reason <text> [--revoke]',
    )
  const client = new Client({ connectionString: loadEnv(migrateEnvSchema).MIGRATION_DATABASE_URL })
  await client.connect()
  try {
    await client.query('BEGIN')
    const rows = await client.query(
      'SELECT u.id FROM users u JOIN two_factor_credentials c ON c.user_id = u.id WHERE u.id = $1 AND u.disabled_at IS NULL AND u.email_verified_at IS NOT NULL AND c.enabled_at IS NOT NULL',
      [userId],
    )
    if (!args.includes('--revoke') && !rows.rowCount)
      throw new Error('Verified, enabled identity with enrolled 2FA required')
    await client.query(
      `INSERT INTO platform_grants (user_id, reason, granted_by, revoked_at) VALUES ($1,$2,$3,$4)
      ON CONFLICT(user_id) DO UPDATE SET version = platform_grants.version + 1, reason = EXCLUDED.reason, granted_by = EXCLUDED.granted_by, revoked_at = EXCLUDED.revoked_at`,
      [userId, reason.trim(), actor, args.includes('--revoke') ? new Date() : null],
    )
    await client.query("SELECT set_config('app.platform_operator_id', $1, true)", [userId])
    // Migration role has the same append-only runtime restrictions only when SET ROLE is used.
    await client.query(
      'INSERT INTO platform_audit(id, operator_id, action, outcome, correlation_id) VALUES ($1,$2,$3,$4,$5)',
      [
        uuidv7(),
        userId,
        args.includes('--revoke') ? 'operator.revoked' : 'operator.granted',
        'SUCCESS',
        actor,
      ],
    )
    await client.query('COMMIT')
    process.stdout.write('Operator authorization recorded.\n')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    await client.end()
  }
}
void main().catch(() => {
  process.stderr.write(
    'Operator provisioning failed. Check arguments and restricted migration access.\n',
  )
  process.exitCode = 1
})

import { PERMISSIONS, ROLE_LABELS, ROLE_PERMISSIONS, ROLE_RANK, ROLES } from '@fenwira/contracts'
import { type ClientBase } from 'pg'

/**
 * Syncs roles, permissions and the role × permission matrix from @fenwira/contracts (the source of
 * truth) into the database. Idempotent; removes grants that are no longer in the matrix.
 */
export async function seedRbac(
  client: ClientBase,
): Promise<{ roles: number; permissions: number; grants: number }> {
  await client.query('BEGIN')
  try {
    for (const role of ROLES) {
      await client.query(
        `INSERT INTO roles (key, name, rank) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, rank = EXCLUDED.rank`,
        [role, ROLE_LABELS[role], ROLE_RANK[role]],
      )
    }
    for (const [key, description] of Object.entries(PERMISSIONS)) {
      await client.query(
        `INSERT INTO permissions (key, description) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description`,
        [key, description],
      )
    }
    await client.query('DELETE FROM permissions WHERE NOT (key = ANY($1::text[]))', [
      Object.keys(PERMISSIONS),
    ])
    let grants = 0
    for (const role of ROLES) {
      const keys = [...ROLE_PERMISSIONS[role]]
      await client.query(
        'DELETE FROM role_permissions WHERE role_key = $1 AND NOT (permission_key = ANY($2::text[]))',
        [role, keys],
      )
      for (const key of keys) {
        await client.query(
          'INSERT INTO role_permissions (role_key, permission_key) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [role, key],
        )
        grants++
      }
    }
    await client.query('COMMIT')
    return { roles: ROLES.length, permissions: Object.keys(PERMISSIONS).length, grants }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  }
}

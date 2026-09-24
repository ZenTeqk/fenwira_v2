import { type ClientBase } from 'pg'

export type RlsViolation = { table: string; problem: string }

/**
 * Every public table with a tenant_id column must have RLS enabled AND forced, plus the
 * tenant_isolation policy (docs/MULTI_TENANCY.md → Testing requirements).
 */
export async function findRlsViolations(client: ClientBase): Promise<RlsViolation[]> {
  const { rows } = await client.query<{
    table: string
    rls: boolean
    forced: boolean
    has_policy: boolean
  }>(`
    SELECT c.relname AS table,
           c.relrowsecurity AS rls,
           c.relforcerowsecurity AS forced,
           EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'tenant_isolation') AS has_policy
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ORDER BY c.relname`)
  const violations: RlsViolation[] = []
  // The tenant root has no tenant_id column but must still be forced-RLS with its own policies.
  const root = await client.query<{ rls: boolean; forced: boolean; policies: string[] }>(`
    SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
           coalesce(array_agg(p.polname::text) FILTER (WHERE p.polname IS NOT NULL), '{}') AS policies
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_policy p ON p.polrelid = c.oid
    WHERE n.nspname = 'public' AND c.relname = 'tenants'
    GROUP BY c.relrowsecurity, c.relforcerowsecurity`)
  const tenants = root.rows[0]
  if (tenants) {
    if (!tenants.rls || !tenants.forced)
      violations.push({ table: 'tenants', problem: 'row level security not enabled and forced' })
    for (const policy of ['tenant_self', 'tenant_member_read']) {
      if (!tenants.policies.includes(policy))
        violations.push({ table: 'tenants', problem: `missing ${policy} policy` })
    }
  }
  for (const r of rows) {
    if (!r.rls) violations.push({ table: r.table, problem: 'row level security not enabled' })
    if (!r.forced) violations.push({ table: r.table, problem: 'row level security not forced' })
    if (!r.has_policy)
      violations.push({ table: r.table, problem: 'missing tenant_isolation policy' })
  }
  return violations
}

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
  for (const r of rows) {
    if (!r.rls) violations.push({ table: r.table, problem: 'row level security not enabled' })
    if (!r.forced) violations.push({ table: r.table, problem: 'row level security not forced' })
    if (!r.has_policy)
      violations.push({ table: r.table, problem: 'missing tenant_isolation policy' })
  }
  return violations
}

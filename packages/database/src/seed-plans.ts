import { PLAN_SEEDS } from '@fenwira/contracts'
import { type ClientBase } from 'pg'

/**
 * Inserts the launch-default plans and their entitlements (P11-D2, D15, D18) when missing.
 * Unlike RBAC, existing rows are never overwritten: plans are configuration operators may change.
 */
export async function seedPlans(client: ClientBase): Promise<{ plans: number }> {
  await client.query('BEGIN')
  try {
    for (const plan of PLAN_SEEDS) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO plans (id, key, name, sort) VALUES (gen_random_uuid(), $1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET key = EXCLUDED.key RETURNING id`,
        [plan.key, plan.name, plan.sort],
      )
      for (const [key, value] of Object.entries(plan.entitlements))
        await client.query(
          `INSERT INTO plan_entitlements (plan_id, key, value) VALUES ($1, $2, $3::jsonb)
           ON CONFLICT (plan_id, key) DO NOTHING`,
          [rows[0]!.id, key, JSON.stringify(value)],
        )
    }
    await client.query('COMMIT')
    return { plans: PLAN_SEEDS.length }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  }
}

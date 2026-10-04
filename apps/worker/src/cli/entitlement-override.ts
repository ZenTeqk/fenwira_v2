import { ENTITLEMENT_KEYS } from '@fenwira/contracts'
import { loadEnv, workerEnvSchema } from '@fenwira/config'
import { Database } from '@fenwira/database'

/**
 * Sets or removes one workspace's entitlement override (highest precedence, docs/BILLING.md →
 * Precedence). Operator tooling until the Step 5 Platform Operator area.
 *   pnpm --filter @fenwira/worker entitlement:override -- --tenant <id> --key max_contacts --value 50000 --reason "Partner" [--days 30]
 *   pnpm --filter @fenwira/worker entitlement:override -- --tenant <id> --key max_contacts --remove
 * `--value`: true | false | null (unlimited) | a number.
 */
async function main(): Promise<void> {
  const env = loadEnv(workerEnvSchema)
  const args = process.argv.slice(2)
  const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
  const tenantId = arg('--tenant')
  const key = arg('--key')
  const remove = args.includes('--remove')
  const raw = arg('--value')
  if (
    !tenantId ||
    !key ||
    !(ENTITLEMENT_KEYS as readonly string[]).includes(key) ||
    (!remove && raw === undefined)
  ) {
    process.stderr.write(
      `usage: entitlement:override --tenant <id> --key <${ENTITLEMENT_KEYS.join('|')}> (--value <v> --reason <text> [--days n] | --remove)\n`,
    )
    process.exit(2)
  }
  const value =
    raw === 'true' ? true : raw === 'false' ? false : raw === 'null' ? null : Number(raw)
  if (typeof value === 'number' && !Number.isFinite(value))
    throw new Error(`invalid --value ${raw}`)
  const days = arg('--days') ? Number(arg('--days')) : null
  const db = Database.connect({ url: env.DATABASE_URL, poolSize: 1 })
  try {
    await db.withTenant(tenantId, async (tx) => {
      if (remove) {
        await tx.tenantEntitlementOverride.deleteMany({ where: { tenantId, key } })
      } else {
        const expiresAt = days ? new Date(Date.now() + days * 86_400_000) : null
        await tx.tenantEntitlementOverride.upsert({
          where: { tenantId_key: { tenantId, key } },
          create: {
            tenantId,
            key,
            value: value as never,
            reason: arg('--reason') ?? 'Operator override',
            expiresAt,
          },
          update: {
            value: value as never,
            reason: arg('--reason') ?? 'Operator override',
            expiresAt,
          },
        })
      }
      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: 'SYSTEM',
          action: remove ? 'entitlement_override.removed' : 'entitlement_override.set',
          targetType: 'entitlement',
          targetId: key,
          changes: (remove ? {} : { value, days }) as never,
        },
      })
    })
    process.stdout.write(
      `${tenantId}: ${key} ${remove ? 'override removed' : `= ${String(value)}`}\n`,
    )
  } finally {
    await db.disconnect()
  }
}

void main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})

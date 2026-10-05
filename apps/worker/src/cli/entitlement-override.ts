import { entitlementOperationSchema } from '@fenwira/contracts'
import { cliArg, operationMetadata, operatorCommand } from './operator-http'
async function main() {
  const raw = cliArg('--value')
  const days = cliArg('--days')
  if (days && (!Number.isInteger(Number(days)) || Number(days) <= 0))
    throw new Error('Days must be positive')
  const removing = process.argv.includes('--remove')
  await operatorCommand(
    'entitlement-operations',
    entitlementOperationSchema.parse({
      kind: removing ? 'override_remove' : 'override_set',
      key: cliArg('--key'),
      ...operationMetadata(),
      ...(removing
        ? {}
        : {
            value:
              raw === 'true' ? true : raw === 'false' ? false : raw === 'null' ? null : Number(raw),
            ...(days
              ? { expiresAt: new Date(Date.now() + Number(days) * 86400000).toISOString() }
              : {}),
          }),
    }),
  )
}
void main().catch(() => {
  process.stderr.write('Override failed; check typed value, arguments and platform session.\n')
  process.exitCode = 1
})

import { subscriptionOperationSchema } from '@fenwira/contracts'
import { cliArg, operationMetadata, operatorCommand } from './operator-http'

/** Marks (or unmarks) Fenwira's own internal workspace through the audited operator API. */
async function main() {
  const value = cliArg('--internal')
  if (value !== 'true' && value !== 'false') throw new Error('Required: --internal true|false')
  await operatorCommand(
    'subscription-operations',
    subscriptionOperationSchema.parse({
      kind: 'internal_flag',
      internal: value === 'true',
      ...operationMetadata(),
    }),
  )
}
void main().catch(() => {
  process.stderr.write('Internal flag operation failed; check arguments and platform session.\n')
  process.exitCode = 1
})

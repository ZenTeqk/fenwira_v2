import { subscriptionOperationSchema } from '@fenwira/contracts'
import { cliArg, operationMetadata, operatorCommand } from './operator-http'
async function main() {
  await operatorCommand(
    'subscription-operations',
    subscriptionOperationSchema.parse({
      kind: 'billing_mode',
      mode: cliArg('--mode'),
      ...operationMetadata(),
    }),
  )
}
void main().catch(() => {
  process.stderr.write('Billing mode operation failed; check arguments and platform session.\n')
  process.exitCode = 1
})

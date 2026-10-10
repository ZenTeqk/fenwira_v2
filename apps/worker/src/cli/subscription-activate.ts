import { platformWorkspaceSchema, subscriptionOperationSchema } from '@fenwira/contracts'
import { cliArg, operationMetadata, operatorCommand, operatorRequest } from './operator-http'
async function main() {
  const workspace = platformWorkspaceSchema.parse((await operatorRequest('')).data)
  const plan = workspace.plans.find(
    (p) => p.key === cliArg('--plan') || p.id === cliArg('--plan-id'),
  )
  if (!plan) throw new Error('Select an existing configured --plan or --plan-id')
  await operatorCommand(
    'subscription-operations',
    subscriptionOperationSchema.parse({
      kind: 'activate',
      planId: plan.id,
      ...operationMetadata(),
    }),
  )
}
void main().catch(() => {
  process.stderr.write('Activation failed; check arguments and platform session.\n')
  process.exitCode = 1
})

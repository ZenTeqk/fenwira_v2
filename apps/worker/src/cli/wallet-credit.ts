import { cliArg, majorToMinor, operationMetadata, operatorCommand } from './operator-http'
async function main() {
  await operatorCommand('wallet-operations', {
    ...operationMetadata(),
    kind: cliArg('--fund-type') === 'PROMOTIONAL' ? 'promotional_credit' : 'paid_credit',
    currency: 'INR',
    amountMinor: majorToMinor(cliArg('--amount')),
    ...(cliArg('--expires-at') ? { expiresAt: cliArg('--expires-at') } : {}),
  })
}
void main().catch(() => {
  process.stderr.write('Wallet credit failed. Check operator session and required metadata.\n')
  process.exitCode = 1
})

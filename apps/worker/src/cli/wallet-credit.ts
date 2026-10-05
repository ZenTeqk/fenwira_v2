import { cliArg, majorToMinor, operationMetadata, operatorCommand } from './operator-http'
async function main() {
  const fundType = cliArg('--fund-type') ?? 'PAID'
  if (!['PAID', 'PROMOTIONAL'].includes(fundType)) throw new Error('Invalid fund type')
  await operatorCommand('wallet-operations', {
    ...operationMetadata(),
    kind: fundType === 'PROMOTIONAL' ? 'promotional_credit' : 'paid_credit',
    currency: 'INR',
    amountMinor: majorToMinor(cliArg('--amount')),
    ...(cliArg('--expires-at') ? { expiresAt: cliArg('--expires-at') } : {}),
  })
}
void main().catch(() => {
  process.stderr.write('Wallet credit failed. Check operator session and required metadata.\n')
  process.exitCode = 1
})

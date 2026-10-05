/** CLI adapter to the same authenticated HTTP/domain boundary as the platform UI. */
export const cliArg = (key: string) => {
  const index = process.argv.indexOf(key)
  return index < 0 ? undefined : process.argv[index + 1]
}
export function operationMetadata() {
  const reason = cliArg('--reason') ?? cliArg('--note')
  const reference = cliArg('--reference'),
    idempotencyKey = cliArg('--idempotency-key')
  if (!reason || !reference || !idempotencyKey)
    throw new Error('Required: --reason, --reference, --idempotency-key')
  return { reason, reference, idempotencyKey }
}
export async function operatorRequest(endpoint: string, body?: unknown) {
  const token = process.env.PLATFORM_SESSION_TOKEN
  const csrf = process.env.PLATFORM_CSRF_TOKEN
  const url = process.env.PLATFORM_API_URL
  const tenantId = cliArg('--tenant')
  if (!token || !csrf || !url || !tenantId)
    throw new Error(
      'Required: --tenant and PLATFORM_API_URL (including /api/v1), PLATFORM_SESSION_TOKEN, PLATFORM_CSRF_TOKEN from an MFA-authenticated platform session',
    )
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsed.hostname))
    throw new Error('Platform API must use HTTPS')
  const response = await fetch(
    `${url.replace(/\/$/, '')}/platform/workspaces/${encodeURIComponent(tenantId)}${endpoint ? `/${endpoint}` : ''}`,
    {
      method: body === undefined ? 'GET' : 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `fw_platform=${token}; fw_platform_csrf=${csrf}`,
        'X-CSRF-Token': csrf,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  )
  if (!response.ok)
    throw new Error(
      `Operator request denied/failed (${response.status}); inspect platform audit with the correlation reference.`,
    )
  return (await response.json()) as { data: unknown }
}
/** Exact decimal parsing: no floating-point rounding in financial commands. */
export function majorToMinor(raw: string | undefined): number {
  if (!raw || !/^\d+(\.\d{1,2})?$/.test(raw))
    throw new Error('--amount requires a positive decimal with at most two places')
  const [whole, fractional = ''] = raw.split('.')
  const minor = BigInt(whole!) * 100n + BigInt(fractional.padEnd(2, '0'))
  if (minor <= 0n || minor > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('Amount outside supported range')
  return Number(minor)
}

export async function operatorCommand(endpoint: string, body: unknown) {
  const response = await operatorRequest(endpoint, body)
  process.stdout.write(`Recorded operation ${(response.data as { id: string }).id}\n`)
}

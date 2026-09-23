import { fetchApiHealth } from '@/lib/health'
import { serverEnv } from '@/lib/env'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const health = await fetchApiHealth(serverEnv.API_INTERNAL_URL)

  return (
    <main>
      <h1>Fenwira</h1>
      <p>Platform foundation (Phase 1). The application shell arrives in Phase 2.</p>

      <h2>API status</h2>
      {health.reachable ? (
        <>
          <p data-testid="api-overall">
            Overall: <strong>{health.overall === 'ok' ? 'Operational' : 'Degraded'}</strong>{' '}
            (version {health.version})
          </p>
          <ul>
            {health.checks.map((check) => (
              <li key={check.name} data-testid={`check-${check.name}`}>
                {check.name}: {check.up ? 'Up' : 'Down'} ({check.detail})
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p data-testid="api-overall">
          Overall: <strong>Unreachable</strong> ({health.reason})
        </p>
      )}
    </main>
  )
}

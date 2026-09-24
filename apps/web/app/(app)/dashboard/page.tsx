import {
  Alert,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  KpiCard,
  PageHeader,
  StatusBadge,
} from '@fenwira/ui'
import { Activity, Database, MessageCircle, Server, Workflow } from 'lucide-react'
import type { Metadata } from 'next'
import { serverEnv } from '@/lib/env'
import { fetchApiHealth } from '@/lib/health'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Dashboard' }

const checkMeta: Record<string, { label: string; icon: React.ReactNode }> = {
  postgres: { label: 'Database', icon: <Database /> },
  redis: { label: 'Cache & realtime', icon: <Server /> },
  queue: { label: 'Job queue', icon: <Workflow /> },
}

export default async function DashboardPage() {
  const health = await fetchApiHealth(serverEnv.API_INTERNAL_URL)
  const operational = health.reachable && health.overall === 'ok'

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description="Platform health today. Messaging, inbox and campaign activity appear here as those modules ship."
      />

      <section aria-labelledby="system-status" className="flex flex-col gap-3">
        <h2 id="system-status" className="text-md font-semibold text-slate">
          System status
        </h2>
        {operational ? (
          <Alert tone="success" title="All systems operational" data-testid="api-overall">
            API version {health.version}. Every dependency is responding.
          </Alert>
        ) : (
          <Alert tone="danger" title="Some services are degraded" data-testid="api-overall">
            {health.reachable
              ? 'One or more dependencies are not responding.'
              : `The API is unreachable (${health.reason}).`}
          </Alert>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="API"
            icon={<Activity />}
            value={<StatusBadge status={health.reachable ? 'UP' : 'DOWN'} />}
            hint={health.reachable ? `Version ${health.version}` : 'Not reachable'}
          />
          {health.reachable
            ? health.checks.map((check) => (
                <KpiCard
                  key={check.name}
                  label={checkMeta[check.name]?.label ?? check.name}
                  icon={checkMeta[check.name]?.icon}
                  value={<StatusBadge status={check.up ? 'UP' : 'DOWN'} />}
                  hint={check.up ? `Responded in ${check.detail}` : check.detail}
                />
              ))
            : null}
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>WhatsApp activity</CardTitle>
          <CardDescription>Messages, conversations and campaigns.</CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={<MessageCircle aria-hidden="true" />}
            title="No WhatsApp number connected"
            description="Once a WhatsApp Business number is connected, delivery, read and response metrics show up here."
          />
        </CardContent>
      </Card>
    </div>
  )
}

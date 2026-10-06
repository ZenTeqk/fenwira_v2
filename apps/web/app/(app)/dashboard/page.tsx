import type { Metadata } from 'next'
import { Dashboard } from '@/components/dashboard/dashboard'
import { serverEnv } from '@/lib/env'
import { fetchApiHealth } from '@/lib/health'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Home' }

/** Platform health is fetched on the server; workspace data loads in the client (permission-aware). */
export default async function DashboardPage() {
  const health = await fetchApiHealth(serverEnv.API_INTERNAL_URL)
  return <Dashboard health={health} />
}

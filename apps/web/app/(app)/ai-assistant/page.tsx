'use client'

import {
  ErrorState,
  ListPage,
  PermissionState,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@fenwira/ui'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { ActivationPage } from '@/components/ai/activation-page'
import { ActivityTab } from '@/components/ai/activity-tab'
import { BehaviourTab } from '@/components/ai/behaviour-tab'
import { KnowledgeTab } from '@/components/ai/knowledge-tab'
import { OverviewTab } from '@/components/ai/overview-tab'
import { PlaygroundTab } from '@/components/ai/playground-tab'
import { useSession } from '@/components/session/session-provider'
import { isNotEnabled, useAiOverview } from '@/lib/ai'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'test', label: 'Test' },
  { id: 'behaviour', label: 'Behaviour' },
  { id: 'activity', label: 'Activity' },
] as const
type TabId = (typeof TABS)[number]['id']

function AiAssistant() {
  const { can } = useSession()
  const overview = useAiOverview()
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'overview') as TabId
  const go = (next: string) => router.replace(`${pathname}?tab=${next}`, { scroll: false })

  const header = {
    title: 'AI Assistant',
    description: 'Answers your WhatsApp customers using only the documents you add.',
  }
  if (!can('automations.read'))
    return <PermissionState what="the AI Assistant" permission="automations.read" />
  if (overview.isLoading)
    return (
      <ListPage header={header}>
        <Skeleton className="h-10 w-96 max-w-full" />
        <Skeleton className="h-64" />
      </ListPage>
    )
  if (isNotEnabled(overview.error))
    return (
      <ListPage header={header}>
        <ActivationPage />
      </ListPage>
    )
  if (overview.isError || !overview.data)
    return (
      <ListPage header={header}>
        <ErrorState onRetry={() => overview.refetch()} />
      </ListPage>
    )

  return (
    <ListPage header={header}>
      <Tabs value={tab} onValueChange={go}>
        <TabsList aria-label="AI Assistant sections">
          {TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview" className="pt-4">
          <OverviewTab overview={overview.data} onGo={go} />
        </TabsContent>
        <TabsContent value="knowledge" className="pt-4">
          <KnowledgeTab />
        </TabsContent>
        <TabsContent value="test" className="pt-4">
          <PlaygroundTab samples={overview.data.sampleQuestions} onGo={go} />
        </TabsContent>
        <TabsContent value="behaviour" className="pt-4">
          <BehaviourTab />
        </TabsContent>
        <TabsContent value="activity" className="pt-4">
          <ActivityTab />
        </TabsContent>
      </Tabs>
    </ListPage>
  )
}

export default function AiAssistantPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <AiAssistant />
    </Suspense>
  )
}

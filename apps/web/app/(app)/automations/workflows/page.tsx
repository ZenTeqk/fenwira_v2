'use client'
import { type FlowTemplateCategory } from '@fenwira/contracts'
import {
  Button,
  EmptyState,
  ListPage,
  PermissionState,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@fenwira/ui'
import { Plus } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { FlowCollection } from '@/components/automation-list/flow-collection'
import { WorkflowSummary, WorkflowHistory } from '@/components/automation-list/workflow-summary'
import { WorkflowStarters } from '@/components/automation-list/workflow-starters'
import { TemplateGallery } from '@/components/automation/template-gallery'
import { useSession } from '@/components/session/session-provider'
import { useFlows } from '@/lib/automation'
export default function AutomationsPage() {
  const [archived, setArchived] = useState(false),
    [tab, setTab] = useState('yours'),
    [category, setCategory] = useState<FlowTemplateCategory>('POPULAR')
  const { can } = useSession(),
    current = useFlows(),
    archive = useFlows(archived),
    flows = archived ? archive : current
  if (!can('automations.read')) return <PermissionState what="automations" />
  return (
    <ListPage
      className="gap-4"
      header={{
        title: 'Workflows',
        descriptionFullWidth: true,
        description: 'Automate assignments, tags, and follow-ups across your workspace.',
        breadcrumbs: [{ label: 'Automations' }, { label: 'Workflows' }],
        linkAs: Link,
        actions: (
          <>
            <WorkflowHistory flows={current.data ?? []} />
            {can('automations.write') ? (
              <Button asChild>
                <Link href="/automations/new">
                  <Plus aria-hidden="true" />
                  Create workflow
                </Link>
              </Button>
            ) : null}
          </>
        ),
      }}
    >
      <WorkflowSummary flows={current.data ?? []} />
      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex min-w-0 flex-col gap-2 border-b border-border-subtle sm:flex-row sm:items-end">
          <TabsList aria-label="Workflow library" className="min-w-0 border-b-0">
            <TabsTrigger value="yours">
              Your workflows
              <span className="rounded-md bg-surface-muted px-2 py-0.5 text-xs">
                {current.data?.length ?? 0}
              </span>
            </TabsTrigger>
            {can('automations.write') ? (
              <TabsTrigger value="starters">Starter workflows</TabsTrigger>
            ) : null}
          </TabsList>
          <Button
            size="sm"
            variant="ghost"
            className="self-end sm:ml-auto"
            aria-pressed={archived}
            onClick={() => {
              setArchived(!archived)
              setTab('yours')
            }}
          >
            {archived ? 'Current workflows' : 'Archived workflows'}
          </Button>
        </div>
        <TabsContent value="yours">
          <FlowCollection
            flows={flows.data ?? []}
            loading={flows.isPending}
            error={flows.isError}
            retry={() => void flows.refetch()}
            empty={
              archived ? (
                <EmptyState
                  title="No archived workflows"
                  description="Restore a workflow here without turning it on."
                />
              ) : undefined
            }
          />
        </TabsContent>
        {can('automations.write') ? (
          <TabsContent value="starters">
            <TemplateGallery key={category} initialCategory={category} />
          </TabsContent>
        ) : null}
      </Tabs>
      {!archived && tab === 'yours' && can('automations.write') ? (
        <WorkflowStarters
          onBrowse={(next) => {
            setCategory(next)
            setTab('starters')
          }}
        />
      ) : null}
    </ListPage>
  )
}

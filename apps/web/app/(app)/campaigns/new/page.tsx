'use client'

import { BuilderPage, PermissionState, Skeleton } from '@fenwira/ui'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { CampaignWizard } from '@/components/campaigns/campaign-wizard'
import { useSession } from '@/components/session/session-provider'

function NewCampaign() {
  const params = useSearchParams()
  const { can } = useSession()
  if (!can('campaigns.write')) return <PermissionState what="campaign creation" />
  return (
    <BuilderPage
      header={{
        title: 'Create campaign',
        breadcrumbs: [{ label: 'Campaigns', href: '/campaigns' }, { label: 'Create campaign' }],
        linkAs: Link,
        description: 'Send a WhatsApp campaign to the right audience.',
      }}
    >
      <CampaignWizard initialTemplateVersionId={params.get('templateVersionId') ?? undefined} />
    </BuilderPage>
  )
}

export default function NewCampaignPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <NewCampaign />
    </Suspense>
  )
}

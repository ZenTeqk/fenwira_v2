'use client'

import { PageHeader } from '@fenwira/ui'
import Link from 'next/link'
import { CampaignWizard } from '@/components/campaigns/campaign-wizard'
import { useSession } from '@/components/session/session-provider'
import { NoAccess } from '@/components/settings/no-access'

export default function NewCampaignPage() {
  const { can } = useSession()
  if (!can('campaigns.write')) return <NoAccess what="campaign creation" />
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="New campaign"
        breadcrumbs={[{ label: 'Campaigns', href: '/campaigns' }, { label: 'New campaign' }]}
        linkAs={Link}
      />
      <CampaignWizard />
    </div>
  )
}

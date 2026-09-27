'use client'

import { PageHeader, PermissionState } from '@fenwira/ui'
import { CampaignWizard } from '@/components/campaigns/campaign-wizard'
import { useSession } from '@/components/session/session-provider'

export default function NewCampaignPage() {
  const { can } = useSession()
  if (!can('campaigns.write')) return <PermissionState what="campaign creation" />
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="New campaign" />
      <CampaignWizard />
    </div>
  )
}

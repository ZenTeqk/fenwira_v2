'use client'

import { PageHeader, PermissionState } from '@fenwira/ui'
import Link from 'next/link'
import { TemplateGallery } from '@/components/automation/template-gallery'
import { useSession } from '@/components/session/session-provider'

/** "Create automation": the template gallery (UX_PATTERNS → Automations). */
export default function NewAutomationPage() {
  const { can } = useSession()
  if (!can('automations.write')) return <PermissionState what="automations" />
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Starter workflows"
        breadcrumbs={[{ label: 'Workflows', href: '/automations' }, { label: 'Create' }]}
        linkAs={Link}
        description="Pick a ready-made automation and fill in a few details, or start from scratch. Nothing runs until you publish."
      />
      <TemplateGallery />
    </div>
  )
}

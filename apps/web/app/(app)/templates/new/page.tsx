'use client'

import { PageHeader } from '@fenwira/ui'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSession } from '@/components/session/session-provider'
import { NoAccess } from '@/components/settings/no-access'
import { TemplateBuilder } from '@/components/templates/template-builder'
import { emptyDraft } from '@/lib/templates'

export default function NewTemplatePage() {
  const { can } = useSession()
  const router = useRouter()
  if (!can('templates.write')) return <NoAccess what="template creation" />
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="New template"
        breadcrumbs={[{ label: 'Templates', href: '/templates' }, { label: 'New template' }]}
        linkAs={Link}
      />
      <TemplateBuilder
        initial={emptyDraft()}
        onSaved={(t) => router.replace(`/templates/${t.id}`)}
      />
    </div>
  )
}

'use client'

import { PageHeader, PermissionState } from '@fenwira/ui'
import { useRouter } from 'next/navigation'
import { useSession } from '@/components/session/session-provider'
import { TemplateBuilder } from '@/components/templates/template-builder'
import { emptyDraft } from '@/lib/templates'

export default function NewTemplatePage() {
  const { can } = useSession()
  const router = useRouter()
  if (!can('templates.write')) return <PermissionState what="template creation" />
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="New template" />
      <TemplateBuilder
        initial={emptyDraft()}
        onSaved={(t) => router.replace(`/templates/${t.id}`)}
      />
    </div>
  )
}

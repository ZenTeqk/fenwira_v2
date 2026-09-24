import { EmptyState, PageHeader } from '@fenwira/ui'
import { Construction } from 'lucide-react'
import { notFound } from 'next/navigation'
import { findPlannedLeaf, navPreviewEnabled } from '@/lib/navigation'

/**
 * Development-only placeholder for navigation items whose phase hasn't shipped
 * (NEXT_PUBLIC_NAV_PREVIEW=true). In every other case unknown paths are a 404.
 */
export default async function PlannedModulePage({
  params,
}: {
  params: Promise<{ slug: string[] }>
}) {
  const { slug } = await params
  const leaf = navPreviewEnabled() ? findPlannedLeaf(`/${slug.join('/')}`) : undefined
  if (!leaf) notFound()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={leaf.label} />
      <EmptyState
        icon={<Construction aria-hidden="true" />}
        title={`Planned for Phase ${leaf.phase}`}
        description="You are seeing this because navigation preview is on (development only)."
      />
    </div>
  )
}

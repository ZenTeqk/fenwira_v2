'use client'

import { type MediaCounts, type ThreadMediaFilter } from '@fenwira/contracts'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useSession } from '@/components/session/session-provider'
import { get } from '@/lib/api/client'
import { mediaCountsKey, MediaResults } from './media-filter'
import { Segmented } from './segmented'

const KINDS: Array<{ value: ThreadMediaFilter; label: string }> = [
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Videos' },
  { value: 'document', label: 'Documents' },
]

/**
 * Shared files (docs/INBOX.md → Media filter): the conversation's images, videos and documents,
 * with the existing type filter, counts and classification (template media headers count).
 * Every file link goes through the visibility-checked download route.
 */
export function SharedFiles({
  conversationId,
  onJump,
}: {
  conversationId: string
  onJump: (messageId: string) => void
}) {
  const { tenantId } = useSession()
  const [kind, setKind] = useState<ThreadMediaFilter>('image')
  const counts = useQuery({
    queryKey: mediaCountsKey(tenantId, conversationId),
    queryFn: () =>
      get<{ data: MediaCounts }>(`/conversations/${conversationId}/media-counts`).then(
        (r) => r.data,
      ),
  })
  return (
    <div className="flex flex-col gap-1 pt-4">
      <div className="px-5">
        <Segmented
          label="File type"
          value={kind}
          onChange={setKind}
          options={KINDS.map((k) => ({
            value: k.value,
            label: counts.data ? `${k.label} ${counts.data[k.value]}` : k.label,
          }))}
        />
      </div>
      <MediaResults conversationId={conversationId} filter={kind} loaded={[]} onJump={onJump} />
    </div>
  )
}

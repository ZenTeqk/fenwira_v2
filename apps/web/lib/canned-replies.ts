'use client'

import { type CannedReply } from '@fenwira/contracts'
import { useQuery } from '@tanstack/react-query'
import { useSession } from '@/components/session/session-provider'
import { get } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'

export const cannedKey = (tenantId: string) => keys.tenant(tenantId, 'canned-replies')

/** Workspace-shared canned replies (docs/INBOX.md → Canned replies). Needs inbox.reply. */
export function useCannedReplies() {
  const { tenantId, can } = useSession()
  return useQuery({
    queryKey: cannedKey(tenantId),
    queryFn: () => get<{ data: CannedReply[] }>('/canned-replies').then((r) => r.data),
    enabled: can('inbox.reply'),
    staleTime: 60_000,
  })
}

/** Replies for a "/…" prefix typed in the composer: shortcut prefix first, then title matches. */
export function matchCanned(replies: CannedReply[], typed: string): CannedReply[] {
  const q = typed.toLowerCase()
  const word = q.slice(1)
  const byShortcut = replies.filter((r) => r.shortcut.startsWith(q))
  const byTitle = replies.filter(
    (r) => !byShortcut.includes(r) && word && r.title.toLowerCase().includes(word),
  )
  return [...byShortcut, ...byTitle].slice(0, 8)
}

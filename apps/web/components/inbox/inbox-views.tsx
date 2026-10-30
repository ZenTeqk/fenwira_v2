import { type ConversationCounts } from '@fenwira/contracts'

export type InboxView = keyof ConversationCounts
export const INBOX_VIEWS: Array<{ id: InboxView; label: string; title: string }> = [
  { id: 'all', label: 'All', title: 'All conversations' },
  { id: 'mine', label: 'Mine', title: 'Mine' },
  { id: 'unassigned', label: 'Unassigned', title: 'Unassigned' },
]

/** Advanced takeover combines with the visible assignee view, search, status and unread. */
export type AdvancedFilter = 'none' | 'takeover'

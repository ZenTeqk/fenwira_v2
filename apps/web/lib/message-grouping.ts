import { type Message } from '@fenwira/contracts'

type GroupMessage = Pick<Message, 'direction' | 'sentByUserId' | 'createdAt' | 'source'>

/** Presentation only: keep sender changes, calendar days and system events visually distinct. */
export function followsSameSender(current: GroupMessage, previous?: GroupMessage): boolean {
  if (!previous || current.direction === 'SYSTEM' || previous.direction === 'SYSTEM') return false
  const elapsed = Date.parse(current.createdAt) - Date.parse(previous.createdAt)
  return (
    current.direction === previous.direction &&
    current.sentByUserId === previous.sentByUserId &&
    current.source === previous.source &&
    new Date(current.createdAt).toDateString() === new Date(previous.createdAt).toDateString() &&
    elapsed >= 0 &&
    elapsed <= 5 * 60_000
  )
}

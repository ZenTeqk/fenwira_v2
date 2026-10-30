'use client'

import { type Conversation } from '@fenwira/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useEligibility } from '@/components/contacts/eligibility-summary'
import { useSession } from '@/components/session/session-provider'
import { keys } from '@/lib/api/keys'
import { useRealtimeEvent, useRealtimeReconnect } from '@/lib/realtime'
import { replyWindow, replyWindowDelay } from '@/lib/reply-window'

/** The centre panel's single eligibility/countdown source. No timer lives in the header strip. */
export function useReplyWindow(conversation: Conversation) {
  const { tenantId } = useSession()
  const client = useQueryClient()
  const eligibility = useEligibility(conversation.contact.id, conversation.id)
  const [now, setNow] = useState(() => Date.now())
  const [rejected, setRejected] = useState(false)
  const { refetch, dataUpdatedAt } = eligibility
  const recheck = useCallback(() => {
    setNow(Date.now())
    void refetch()
    void client.invalidateQueries({
      queryKey: keys.tenant(tenantId, 'inbox', 'conversation', conversation.id),
    })
  }, [refetch, client, tenantId, conversation.id])
  useEffect(() => {
    setRejected(false)
    setNow(Date.now())
  }, [dataUpdatedAt])
  useEffect(() => {
    const focus = () => {
      if (document.visibilityState === 'visible') recheck()
    }
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', focus)
    return () => {
      window.removeEventListener('focus', focus)
      document.removeEventListener('visibilitychange', focus)
    }
  }, [recheck])
  useRealtimeReconnect(recheck)
  useRealtimeEvent<{ conversationId?: string }>('conversation.updated', (event) => {
    if (event.conversationId === conversation.id) recheck()
  })
  useRealtimeEvent<{ conversationId?: string; direction?: string }>('message.created', (event) => {
    if (event.conversationId === conversation.id && event.direction === 'INBOUND') recheck()
  })
  const previousExpiry = useRef(conversation.serviceWindow.expiresAt)
  useEffect(() => {
    if (previousExpiry.current !== conversation.serviceWindow.expiresAt) {
      previousExpiry.current = conversation.serviceWindow.expiresAt
      recheck()
    }
  }, [conversation.serviceWindow.expiresAt, recheck])

  const known =
    !!eligibility.data &&
    !eligibility.isError &&
    (!eligibility.data.freeform.allowed || !!eligibility.data.serviceWindowExpiresAt)
  const expiresAt = eligibility.data?.serviceWindowExpiresAt
  const serverClosed = known && eligibility.data?.freeform.code === 'CONVERSATION_WINDOW_CLOSED'
  const windowState =
    rejected || serverClosed ? { kind: 'closed' as const } : replyWindow(expiresAt, now, known)
  useEffect(() => {
    if (!known || rejected || serverClosed) return
    const delay = replyWindowDelay(expiresAt, Date.now())
    if (delay === null) return
    const timer = window.setTimeout(() => {
      const next = Date.now()
      setNow(next)
      if (expiresAt && next >= Date.parse(expiresAt)) void refetch()
    }, delay)
    return () => window.clearTimeout(timer)
  }, [expiresAt, now, known, rejected, serverClosed, refetch])
  return {
    eligibility,
    window: windowState,
    recheck,
    rejectExpiry: () => {
      setRejected(true)
      recheck()
    },
  }
}

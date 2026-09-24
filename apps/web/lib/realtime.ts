'use client'

import { useEffect, useRef } from 'react'
import { io, type Socket } from 'socket.io-client'
import { useSession } from '@/components/session/session-provider'

/**
 * Realtime events (docs/ARCHITECTURE.md → Realtime). One Socket.IO connection per browser tab,
 * authenticated by the session cookie and joined to the active tenant's room. Events are hints to
 * refresh; screens still load data over HTTP, so a missed event only delays an update.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1'

let current: { tenantId: string; socket: Socket } | null = null

function socketFor(tenantId: string): Socket {
  if (current?.tenantId === tenantId) return current.socket
  current?.socket.close()
  const socket = io(new URL(API_URL).origin, {
    path: '/ws',
    withCredentials: true,
    transports: ['websocket'],
    auth: { tenantId },
  })
  current = { tenantId, socket }
  return socket
}

/** Calls `handler` for every `event` in the active tenant while the component is mounted. */
export function useRealtimeEvent<T>(event: string, handler: (payload: T) => void): void {
  const { tenantId } = useSession()
  const latest = useRef(handler)
  latest.current = handler
  useEffect(() => {
    const socket = socketFor(tenantId)
    const listener = (payload: T) => latest.current(payload)
    socket.on(event, listener)
    return () => {
      socket.off(event, listener)
    }
  }, [event, tenantId])
}

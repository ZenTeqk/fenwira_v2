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

/** The tenant socket, for emits (joins, heartbeats). */
export function useSocket(): Socket {
  const { tenantId } = useSession()
  return socketFor(tenantId)
}

/** Joins `conversation:{id}` while mounted (typing locks, notes); rejoins after reconnects. */
export function useConversationRoom(conversationId: string | null): void {
  const socket = useSocket()
  useEffect(() => {
    if (!conversationId) return
    const join = () => socket.emit('conversation.join', { conversationId })
    join()
    socket.on('connect', join)
    return () => {
      socket.off('connect', join)
      socket.emit('conversation.leave', { conversationId })
    }
  }, [socket, conversationId])
}

/** Presence heartbeat every 20 s; AWAY after 10 minutes without input (docs/INBOX.md → Presence). */
export function usePresenceHeartbeat(enabled: boolean): void {
  const socket = useSocket()
  useEffect(() => {
    if (!enabled) return
    let last = Date.now()
    const touch = () => {
      last = Date.now()
    }
    const beat = () =>
      socket.emit('presence.heartbeat', {
        status: Date.now() - last > 10 * 60_000 ? 'AWAY' : 'ONLINE',
      })
    beat()
    socket.on('connect', beat)
    const t = setInterval(beat, 20_000)
    for (const ev of ['keydown', 'pointerdown', 'focus'] as const)
      window.addEventListener(ev, touch)
    return () => {
      clearInterval(t)
      socket.off('connect', beat)
      for (const ev of ['keydown', 'pointerdown', 'focus'] as const)
        window.removeEventListener(ev, touch)
    }
  }, [socket, enabled])
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

/** Re-read authorized HTTP state after reconnect; websocket hints cannot replay missed events. */
export function useRealtimeReconnect(handler: () => void): void {
  const socket = useSocket()
  const latest = useRef(handler)
  latest.current = handler
  useEffect(() => {
    const listener = () => latest.current()
    socket.on('connect', listener)
    return () => {
      socket.off('connect', listener)
    }
  }, [socket])
}

# ADR-0010: WebSockets via Socket.IO for realtime

**Status:** Accepted

## Context

The inbox needs live messages, status ticks, assignment changes, presence and compose locks. Workers (separate processes) must be able to emit events.

## Decision

A Socket.IO gateway in NestJS with `@socket.io/redis-adapter`. Workers emit with `@socket.io/redis-emitter`. Authentication is by cookie at the handshake, and membership is verified before joining the `tenant:{id}` room. Rooms are `tenant:`, `user:` and `conversation:`. Clients treat events as cache-patch hints and refetch on reconnect rather than replaying missed events.

## Consequences

- Rooms, reconnection and multi-instance fan-out come built in.
- Socket.IO is its own protocol (not raw WS), so the client must use `socket.io-client`.

## Alternatives rejected

- **Raw `ws`:** we would build rooms, reconnection and fan-out ourselves.
- **Server-Sent Events:** one-way only. We need client heartbeats for presence and locks.
- **Polling:** latency and load.

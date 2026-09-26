# Phase 7 — Multi-Agent Shared Inbox

**Goal:** two or more agents work the same inbox concurrently without duplicate or conflicting replies and without tenant leakage. Completing this phase completes **Fenwira Core**.

**Read:** `AGENTS.md`, `docs/INBOX.md`, `docs/MESSAGING_ENGINE.md`, `docs/DESIGN_SYSTEM.md` (inbox colors).

## Build

### Backend

1. **Conversation:**
   - status: OPEN, PENDING, SNOOZED or RESOLVED
   - assignee_id (individual agents only; teams/queues are deferred per decision I1, and nothing may prevent adding them later)
   - unread counts per agent
   - `last_customer_message_at`, `service_window_expires_at` (the server owns these, and they are updated by the inbound worker)
   - `automation_state`: AUTOMATION_ACTIVE, AGENT_TAKEOVER or AUTOMATION_PAUSED
   - first_response_at and snoozed_until
2. **Entities:** `ConversationNote` (internal and never sent) and `ConversationTag`. Conversation events (assigned, resolved, takeover, …) are stored as system messages.
3. **Assignment:** manual, self-assign, and optional round-robin across online agents. Assigning an already-assigned conversation needs `inbox.reassign`.
4. **Collision control:** a reply requires either being the assignee or holding a short-lived compose lock (Redis, 30s, renewed while typing). The server rejects a send from a non-holder with a typed error. The UI shows "Priya is replying…".
5. **Human takeover (server-enforced):** an agent reply automatically sets AGENT_TAKEOVER. While it is set, automations must not send. `MessagingService` rejects `source: 'automation'` for that conversation. The agent can return the conversation to automation explicitly.
6. **Presence:** online, away or offline per agent over WebSocket, backed by a Redis heartbeat.
7. **Search:** Postgres full-text search on message text and contact name/phone, tenant-scoped.
8. **APIs:** list with cursor and filters (status, assignee, unassigned, tag, unread, window open/closed), thread (paginated backwards), reply (text/media/template via `MessagingService`), notes, assign, tag, resolve, snooze, reopen, mark read.
9. **Canned replies** (decision I2): lightweight saved text replies (a title and a body) that the composer inserts for editing. They never send by themselves. Ownership and management wait on open question I3. No variables, media or shared libraries.

### Frontend: three panes `Conversations | Chat | Contact`

- **List:** filters and search, unread badge, window-state indicator, assignee avatar. The selected item gets `primary-soft` plus a `primary` left border.
- **Chat:** virtualized thread. Outbound bubbles use `primary-soft`, inbound use `surface`, and system events use a `neutral-soft` pill. Per-message status ticks come from StatusBadge semantics. Notes are visually distinct and labeled "Internal". Attachments upload through a presigned MinIO URL. There is a template picker (sending approved templates; the full builder is Phase 8). A service window countdown appears in the header, and when the window is closed the composer switches to template-only with an explanation. Takeover state shows as an `info` banner with a "Return to automation" action.
- **Canned replies:** a picker in the composer that inserts the chosen reply's text into the reply box.
- **Contact:** a compact Contact 360 (from Phase 6) with consent status, tags, notes and past conversations.
- Realtime: new messages, status ticks, assignment changes and presence arrive live, with optimistic sends reconciled by idempotency key.
- Mobile: the panes collapse to a single stack with back navigation.

## Acceptance criteria

- [ ] Two agents in two browsers on the same conversation: only the lock holder or assignee can send, and the other sees the typing indicator and a disabled composer.
- [ ] 100 inbound messages burst into 20 conversations: every message appears in order, unread counts are correct, and nothing is duplicated.
- [ ] Outside the service window, a freeform reply is blocked by the server even if the UI check is bypassed (API test).
- [ ] During AGENT_TAKEOVER, an automation-sourced send is rejected (test).
- [ ] An agent in Tenant A never receives WebSocket events from Tenant B (test with two sockets).
- [ ] An agent inserts a canned reply, edits it, and sends it through the normal reply path (lock and window rules still apply). Another tenant's canned replies are never visible.
- [ ] Search returns only the current tenant's conversations.
- [ ] Lighthouse accessibility score of at least 90 on the inbox page.

# Inbox

## Scope

The multi-agent shared inbox: conversation lifecycle, assignment, the service window, human takeover, concurrency and collision control, presence, unread tracking, search and realtime behavior.

## Decisions

### Conversation model

- **One conversation per (contact, WhatsApp phone number).** It is long-lived: resolving it doesn't close the thread, and a new inbound message reopens it.
- Status:

| Status | Meaning | Enters when |
| --- | --- | --- |
| `OPEN` | Needs attention | New or reopened on inbound; manual reopen |
| `PENDING` | Waiting on the customer | Agent sets it |
| `SNOOZED` | Hidden until `snoozed_until` | Agent sets it. The maintenance job, or the next inbound, returns it to OPEN. |
| `RESOLVED` | Done | Agent resolves. The next inbound → OPEN (and emits `conversation.opened`). |

- Every status, assignment and takeover change writes a `SYSTEM` message (`type = SYSTEM_EVENT`, `content = {event, actorId, from, to}`), rendered as a neutral pill in the thread.

### Service window (the server owns it)

- `last_customer_message_at` and `service_window_expires_at` are set only by the inbound processor (`MESSAGING_ENGINE.md`).
- API responses include `serviceWindow: { expiresAt, isOpen }`. The UI counts down from `expiresAt`, and at zero the composer switches to template-only with the text "The 24-hour window has closed. Send an approved template to restart the conversation." The server enforces the same rule regardless of the UI.

### Assignment

| Action | Permission | Rule |
| --- | --- | --- |
| Self-assign an unassigned conversation | `inbox.assign_self` | |
| Assign or reassign to anyone | `inbox.reassign` | The target must be an ACTIVE member with `inbox.reply` |
| Unassign | Assignee, or `inbox.reassign` | |
| Auto-assign | Tenant setting `auto_assign = OFF \| ROUND_ROBIN` | On `conversation.opened`, pick the ONLINE agent with `inbox.reply` and the fewest OPEN assigned conversations (ties broken by last-assigned time). If no one is online, leave it unassigned. |

Assignment emits `conversation.assigned` (in-app notification to the assignee) and a WS `conversation.assigned`.

### Human takeover

| `automation_state` | Automation may send? | Enters when |
| --- | --- | --- |
| `AUTOMATION_ACTIVE` | Yes | Default; the agent clicks "Return to automation" |
| `AGENT_TAKEOVER` | **No** | Any INBOX-source send by an agent (automatic), or the agent clicks "Take over" |
| `AUTOMATION_PAUSED` | **No** | The agent pauses automation without taking over (for example while investigating) |

- The server enforces this: `MessagingService` rejects `source = AUTOMATION` unless the state is `AUTOMATION_ACTIVE` (`AUTOMATION_BLOCKED_BY_TAKEOVER`), and the automation engine checks it before each send step (`AUTOMATION_ENGINE.md`).
- Tenant setting `takeover_auto_release_hours` (default null = never): if set, the maintenance job returns `AGENT_TAKEOVER` → `AUTOMATION_ACTIVE` when there has been no agent message for N hours and the conversation is RESOLVED.
- UI: the takeover state shows an `info` badge in the list and an `info` banner in the thread, with the action "Return to automation".

### Collision control (compose lock)

- Redis key `lock:compose:{conversationId}` = `{userId, userName, expiresAt}`, `SET NX PX 30000`.
- The client takes the lock on the first keystroke (`POST /conversations/:id/compose-lock`) and renews it by sending `compose.heartbeat` over WS every 10 s while the composer has content. It releases on send, clear or blur (and after 30 s of inactivity via the TTL).
- Send rule: the sender must hold the lock, **or** be the assignee while the lock is free. Otherwise the server returns `COMPOSE_LOCKED` with the holder's name.
- The assignee can take the lock from a non-assignee (`force: true`). The previous holder gets `compose.lock` (released) and their draft is kept locally.
- Other viewers see "Priya is replying…" and a disabled composer with a "Take over" option if they are the assignee or have `inbox.reassign`.

### Presence

- A Redis hash `presence:{tenantId}` → `userId → {status, lastSeen}`. The client sends `presence.heartbeat` every 20 s. After 60 s without one, the user is OFFLINE.
- Statuses: `ONLINE`, `AWAY` (set manually, or after 10 minutes idle in the browser) and `OFFLINE`. Changes broadcast `presence.updated` to `tenant:{id}`.
- Auto-assign considers `ONLINE` only.

### Unread tracking

- `conversation_read_states (conversation, user)` rows are created lazily for users who have opened the conversation, and for the assignee.
- Inbound messages increment `unread_count` for all existing read-state rows of that conversation.
- `POST /conversations/:id/read` sets `unread_count = 0` and `last_read_message_id`. It also queues a Meta mark-as-read for the latest inbound message (and a typing indicator when the agent starts composing, subject to open question M1).
- The list shows the current user's unread count. The nav badge is the number of conversations with unread > 0 visible to the user.

### Visibility

With `inbox.read_all` (default for every role), a user sees all conversations. When the tenant sets `inbox_visibility = ASSIGNED_ONLY`, AGENTs see only conversations assigned to them plus unassigned ones.

### List filters and views

Built-in views: **Mine**, **Unassigned**, **All**, **Takeover** and **Resolved**. Filters: status, assignee, tag, unread, window open/closed, phone number. Sort: last activity (default) or oldest waiting.

### Search

- Postgres full-text search over `messages.text_search` (config `simple`, so it works across languages without stemming), plus a trigram match on contact name and a prefix match on phone.
- The endpoint is `GET /conversations?q=…`, which returns conversations with the matching message snippet. It is tenant-scoped via RLS.

### Attachments

Upload through `POST /files/upload-url` (purpose `MESSAGE_MEDIA`) → PUT to MinIO → `POST /files/:id/complete` (magic-byte sniff, size check per Meta limits) → send with `{type: IMAGE|DOCUMENT|AUDIO|VIDEO, fileId, caption?}`. The outbound worker uploads the file to Meta media and sends it by media ID.

### Realtime (client behavior)

- On opening a conversation, the client joins `conversation:{id}` and leaves the previous one.
- `message.created`: append to the thread cache if open, and update the list item (preview, time, unread) in every cached list page.
- `message.status`: patch the message's status ticks.
- `conversation.updated` and `conversation.assigned`: patch or move the list item between views.
- Optimistic send: insert a local message with the client-generated idempotency key, then reconcile when the server's `message.created` arrives with the same key.
- On reconnect: refetch the visible list and the open thread (don't try to replay missed events).

### Layout and colors (from `DESIGN_SYSTEM.md`)

`Conversations | Chat | Contact` at 320 px / flex / 340 px. Below 1280 px the Contact pane becomes a drawer. Below 768 px there is a single pane with back navigation. Outbound bubbles are `primary-soft`, inbound are `surface` with a border, system events are a `neutral-soft` pill, the selected conversation is `primary-soft` with a `primary` left border, takeover is `info`, and internal notes are `warning`-tinted with an "Internal" label.

### SLA fields (display only in v2)

`first_response_at` is set on the first INBOX-source outbound message after an OPEN. It feeds agent first-response-time analytics (Phase 11).

## Open questions

| # | Question | Owner |
| --- | --- | --- |
| I1 | Are teams or queues (grouping agents) needed in v2? Assumed no: assignment is to individual users. | Product |
| I2 | Are canned responses or saved replies needed in Phase 7? Assumed no (candidate for Phase 8+). | Product |

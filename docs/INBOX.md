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

Assignment is to individual users (decision I1). Teams and queues are deferred. Nothing in the API or schema assumes an individual is the only possible routing target: `assign` takes an object body, and a team would be a separate nullable column.

Assignment emits `conversation.assigned` (in-app notification to the assignee) and a WS `conversation.assigned`.

### Human takeover

| `automation_state` | Automation may send? | Enters when |
| --- | --- | --- |
| `AUTOMATION_ACTIVE` | Yes | Default; the agent clicks "Return to automation" |
| `AGENT_TAKEOVER` | **No** | Any INBOX-source send by an agent (automatic), or the agent clicks "Take over" |
| `AUTOMATION_PAUSED` | **No** | The agent pauses automation without taking over (for example while investigating) |

- The server enforces this: `MessagingService` rejects `source = AUTOMATION` unless the state is `AUTOMATION_ACTIVE` (`AUTOMATION_BLOCKED_BY_TAKEOVER`), and the automation engine checks it before each send step (`AUTOMATION_ENGINE.md`).
- Tenant setting `takeover_auto_release_hours` (default null = never): if set, the maintenance job returns `AGENT_TAKEOVER` → `AUTOMATION_ACTIVE` when there has been no agent message for N hours and the conversation is RESOLVED.
- UI: takeover is available in list-row details and the Takeover view. The thread shows a compact contextual state with the action "Return to automation"; automation remains server-enforced.

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
- `POST /conversations/:id/read` sets `unread_count = 0` and `last_read_message_id`. It also queues a Meta mark-as-read for the latest inbound message. Typing indicators are optional (decision M1): they are built only if the WhatsApp API reliably supports them.
- The list shows the current user's unread count. The nav badge is the number of conversations with unread > 0 visible to the user.

### Visibility

With `inbox.read_all` (default for every role), a user sees all conversations. When the tenant sets `inbox_visibility = ASSIGNED_ONLY`, AGENTs see only conversations assigned to them plus unassigned ones.

### List filters and views

Built-in views: **Mine**, **Unassigned**, **All**, **Takeover** and **Resolved**. Filters: status, assignee, tag, unread, window open/closed, phone number. Sort: last activity (default) or oldest waiting.

### Search

- Postgres full-text search over `messages.text_search` (config `simple`, so it works across languages without stemming), plus a trigram match on contact name and a prefix match on phone.
- The endpoint is `GET /conversations?q=…`, which returns conversations with the matching message snippet. It is tenant-scoped via RLS.

### Canned replies (decisions I2 and I3, Phase 7)

- **Workspace-shared** saved replies. Personal/private replies are out of the initial v2 scope.
- Fields: `shortcut` (for example `/hello`, `/price`, `/address`, `/thanks`), `title` and a plain-text `body`. The shortcut starts with `/`, then 1–32 lowercase letters, digits, `-` or `_`, and is unique within the workspace (case-insensitive).
- **Permissions:** OWNER, ADMIN and MANAGER create, edit, delete and use them (`inbox.canned_replies.manage` plus `inbox.reply`). AGENT uses them (`inbox.reply`). VIEWER can neither send nor modify.
- **Using one:** typing `/` at the start of the reply box, or opening the canned-replies button, shows matching replies. Choosing one **inserts** its body into the reply box for editing. It never sends by itself, so the normal reply path (compose lock, service window, `MessagingService`) applies unchanged.
- **Managing them:** Settings → Workspace → Canned replies.
- Tenant-isolated under RLS, and covered by the tenant and security matrices.
- Out of scope: variables, media, templates, folders, personal replies and analytics.

### Attachments

Upload through `POST /files/upload-url` (purpose `MESSAGE_MEDIA`) → PUT to MinIO → `POST /files/:id/complete` (magic-byte sniff, size check per Meta limits) → send with `{type: IMAGE|DOCUMENT|AUDIO|VIDEO, fileId, caption?}`. The outbound worker uploads the file to Meta media and sends it by media ID.

### Template messages

A template message renders from its stored snapshot (docs/MESSAGING_ENGINE.md → Template snapshot), in the outbound bubble:

- a "Template: <name>" label in `text-secondary`, then the header (image preview, or a chip for a video or document), the body with line breaks kept, and the footer;
- a body longer than about 8 lines is collapsed, with Read more / Show less (`aria-expanded`);
- buttons as WhatsApp-style display-only rows (`bg-surface`, `border`, `primary-strong` label and type icon; the URL, phone number or code is in the row's `title`). They are not controls, so nothing in them is focusable;
- a partial snapshot shows what is available plus "Original template no longer available";
- the bubble is a `group` named by its label and body text.

Footer and the partial note use `text-secondary`, not `text-muted`: muted text is 3.4:1 on `message-outbound` and fails AA.

### Media filter

Below the thread header, chips All / Images / Videos / Documents filter the open conversation, each with its count from `GET /conversations/:id/media-counts`. They are toggle buttons (`aria-pressed`): idle `bg-surface` with `border-strong` and `text-secondary`, hover `bg-neutral-soft`, active `bg-primary-soft` with `primary-strong` text and border, and the shared `primary-strong` focus ring. Clicking the active chip goes back to All. The selection resets when you switch conversation.

- Classification (`mediaKindOf` in contracts, and the generated `messages.media_type` column on the server): image, video and document messages, plus template messages whose header is an image, video or document. Stickers and audio are excluded; Audio and Links can be added as more `media_type` values later.
- The view shows loaded messages filtered client-side immediately, then pages from `GET /conversations/:id/messages?type=image|video|document`, so pagination and counts stay correct.
- Images and videos show as a thumbnail grid. A thumbnail opens a simple lightbox (the inbox has no other media viewer). Documents show as a list with file name, type, size and date. Every item has "Jump to message", which returns to All, loads earlier pages until the message is in the thread, scrolls to it and moves focus there.
- Empty state: a `neutral-soft` icon tile with `text-muted` copy ("No images in this conversation").
- A template's media header is a template sample file; `GET /files/:id/download-url` serves it once a message uses it.

### Realtime (client behavior)

- On opening a conversation, the client joins `conversation:{id}` and leaves the previous one.
- `message.created`: append to the thread cache if open, and update the list item (preview, time, unread) in every cached list page.
- `message.status`: patch the message's status ticks.
- `conversation.updated` and `conversation.assigned`: patch or move the list item between views.
- Optimistic send: insert a local message with the client-generated idempotency key, then reconcile when the server's `message.created` arrives with the same key.
- On reconnect: refetch the visible list and the open thread (don't try to replay missed events).

### Layout and colors (from `DESIGN_SYSTEM.md`)

Experience V2 Inbox: the global shell shares the approved Home geometry (224px expanded sidebar, 56px topbar). Following user review, the separate 176px views column is removed. Its six existing views are available from an icon menu beside the conversation-list heading at every width. `Conversations | Chat | Contact` at 320px / flex / 256px at 1440; the thread receives the freed 184px (rail plus gutter), becoming 608px. At 1024 the list remains 264px and views stay in the header menu; below 1024 the list remains 280px. Below 1280 px the Contact pane becomes a drawer. Below 768 px there is a single pane with back navigation. Outbound bubbles are `message-outbound`, inbound are `surface` with a fine border, system events are a `neutral-soft` pill, the selected conversation is `primary-soft` with a `primary` left border, takeover is `info`, and internal notes are `note-soft` with an "Internal note" label. Message/note surfaces occupy at most five-sixths of the usable thread width. These are presentation dimensions, not changes to Inbox lifecycle or authorization.

### SLA fields (display only in v2)

`first_response_at` is set on the first INBOX-source outbound message after an OPEN. It feeds agent first-response-time analytics (Phase 11).

## Implementation notes (Phase 7)

- **Modules.** `apps/api/src/modules/inbox` owns the inbox: `InboxService` (list, thread, reply, assignment, status, takeover, notes, tags, notifications, settings), `ComposeLockService`, `PresenceService`, `InboxGateway` (`compose.heartbeat`, `presence.heartbeat`) and the worker's `InboxEventsProcessor`. Replies still go through `MessagingService`, the only send path.
- **Reply rule.** If someone else holds the lock → 409 `COMPOSE_LOCKED` (`details.holder`). If the lock is free, the sender takes it for the send and releases it after; this also covers a non-assignee who hasn't typed yet. The first INBOX send while `AUTOMATION_ACTIVE` moves the conversation to `AGENT_TAKEOVER` and writes a `takeover` system event.
- **Ordering.** An inbound message's `created_at` is Meta's timestamp, so a burst delivered out of order still sorts correctly. The conversation's last-message fields only move forward (a `newerMessage` guard).
- **Unread.** `conversations.inbound_count` is the fallback for users without a read-state row, so a conversation nobody has opened is unread for everyone, with no fan-out writes. Inbound increments every existing row and inserts the assignee's row if missing.
- **Auto-assign** runs on the `inbox.events` queue from `conversation.opened` (round robin over ONLINE members with `inbox.reply`, fewest OPEN assigned, then the oldest `assigned_at`).
- **Maintenance.** A 60 s repeatable job calls `system.inbox_maintenance_due` (X13) and, per tenant, reopens expired snoozes (`status_changed` with `reason: snooze_ended`) and releases idle takeovers (`automation_resumed` with `reason: auto_release`).
- **Notifications.** An in-app `notifications` table (assignment, a mention in a note) with a bell in the top bar. The payload goes to `user:{id}` as `notification.created`.
- **Presence.** `AWAY` is accepted from the client heartbeat; the browser idle timer that sets it is not built yet. A socket disconnect marks the user OFFLINE once they have no other open sockets.
- **Not built yet:** the `POST /messages/:id/retry` endpoint. Meta typing indicators are optional (M1) and are not built.

## Open questions

None. Resolved in the specification freeze (2026-09-26); see `PRODUCT.md` → Decision register.

## Experience V2 presentation (2026-10-06)

The separate view rail uses existing Mine/Unassigned/All/Takeover/Resolved queries; Unread maps to the existing server unread filter. Status filtering uses the existing status parameter. No team queues. Avatar-led rows show real assignment, unread and window state. Consecutive same-sender messages within five minutes group visually, with day separators; notes and system messages interrupt grouping. Read-only roles have no composer. The composer reuses shared Textarea/focus and displays server eligibility/connection explanations. Reconnect refreshes authorized Inbox HTTP queries after rejoining rooms. No backend/schema/lifecycle changes. See `design/FENWIRA_EXPERIENCE_V2.md`.

## Inbox final visual fidelity checkpoint

The `e50211a` reconstruction is not visually approved. This focused pass retains the approved Home shell and pane widths, while standard conversation rows become two-line identity/preview rows with 36px deterministic initials. Assignment/window/takeover/pending metadata is available in row details and selected-conversation header/context; existing filter queries are unchanged. Contact/conversation responses expose no supported profile photo URL, so no avatar backend or fake photos are introduced.

The primary thread header uses compact assignment/Resolve/More controls and identity/status. Healthy window, conversation tags and takeover share a quiet contextual area instead of stacked banners; composer warnings for closing/closed/restricted/disconnected states remain. The warm thread has an original, decorative 5%-opacity SVG pattern and the AA-tested outbound-only emerald token. Reply/note writing grows from one line to a 160px cap, then scrolls internally; mode and toolbar remain explicit with 40px mobile controls. Customer context prioritizes identity/assignment/tags, compact server eligibility and keyboard-accessible full eligibility/consent details, then real notes/history. All domain, permission, locking, realtime/offline, draft and sending paths remain authoritative. See [final-fidelity report](design/EXPERIENCE_V2_INBOX_FINAL_FIDELITY.md); stop for visual review.

## Compact view menu — user-directed refinement

The user requested removal of the redundant Inbox view column. All/Mine/Unassigned/Unread/Takeover/Resolved now live in the accessible icon menu beside the list heading. The current heading and menu check/accessible current state identify the selected view; Escape restores trigger focus. Search, status/unread filters, underlying query parameters, permissions and all messaging behavior are unchanged. The 1440 thread gains 184px; the global Home shell and customer context stay unchanged. Separate review evidence: [view-menu checkpoint](design/experience-v2/evidence/inbox-view-menu/README.md).

## Customer-details arrow toggle

The chat header has a chevron with **Hide customer details / Show customer details** labels and tooltips. On desktop (1280px and wider), the panel starts visible; the right-pointing chevron hides it, and the left-pointing chevron restores it. Collapsing the 256px panel and its gutter gives the 1440px thread another 264px (608px → 872px). The control exposes `aria-expanded` and `aria-controls`; keyboard toggling retains focus and the current reply draft. Visibility is local to the selected conversation, with no persisted customer preference.

Below 1280px the same control opens the existing accessible details drawer. Escape/close returns focus to the control. If the viewport grows to desktop while the drawer is open, the drawer closes and the inline panel resumes without leaving a modal overlay. Existing customer content, permissions, eligibility, messaging and Home remain unchanged. [Review evidence](design/experience-v2/evidence/inbox-contact-toggle/README.md).

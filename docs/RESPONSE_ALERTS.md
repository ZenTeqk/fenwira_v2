# Response alerts (missed enquiries)

## Scope

Alerts when a customer waits too long for a staff reply. They are tracked as persisted "waiting for staff" episodes.

- **Module:** `apps/api/src/modules/response-alerts` (settings API and the `inbox.alerts` worker processor).
- **Business-time arithmetic:** `packages/contracts/src/business-time.ts`.
- **Shared switch:** the same rollout switch as [FOLLOW_UPS_AND_SALES.md](FOLLOW_UPS_AND_SALES.md).
- **Alerts are internal:** they arrive as in-app notifications (the bell) and never send a WhatsApp message.

## Configuration

**Settings → Inbox → Response alerts** needs `inbox.alerts.manage` (Owner, Admin, Manager).

| Setting | Default | Notes |
| --- | --- | --- |
| Enabled | off | Turning it on records `enabled_at` (see Rollout) |
| Still unassigned | 5 business minutes | Notifies every active member who can assign (`inbox.reassign`) |
| No staff reply | 15 | Notifies the assignee, or the assigners when unassigned |
| Escalate | 30 | Notifies the escalation recipients; must be later than "No staff reply" |
| Escalation recipients | none | Active members with `inbox.reassign`, at most 20 |

**Business hours and timezone are not duplicated here.**

- **Business hours:** alerts use the workspace's existing schedule (Automations → Reply Studio → Business hours: timezone, Monday-first week, holidays). Unconfigured workspaces get its default, Mon–Fri 09:00–18:00 IST.
- **Timezone:** the page shows the schedule and links to the business-hours editor. The workspace timezone itself is set in Settings → Workspace.
- **Notification preferences:** Fenwira has none yet, so there is nothing to link to.

**Configuration issues** are shown on the page:

- An escalation fell due but no recipient is an active manager.
- An alert fell due but nobody can assign conversations.
- Business hours are closed every day.

When a recipient is missing, nothing is sent: an alert is never redirected to anyone else, and never to another workspace. Saving the settings clears the issue.

## Timer semantics

**A waiting episode:**

- **Starts** at a customer message that needs a reply. The message is INBOUND from the customer, not a reaction, and the contact is not blocked.
- **Keeps the oldest wait.** While an episode is open, more customer messages don't move its start.
- **One open episode per conversation** (partial unique index).

**The staff timer (`clock_started_at`):**

- It counts **business minutes only**: within open hours, across days, holidays and DST changes. The opening and closing times are wall-clock times in the schedule's timezone.
- It **doesn't run while a bot is handling the conversation.** That means automation is active and a run is RUNNING, or waiting for the customer's answer to a bot menu, or in an AI Assistant conversation. A delay step is not "handling".
- It **starts at handover:** takeover, pause, an AI hand-off, or the bot run finishing.
- **Assignment** clears the unassigned condition but never resets the timer.

**The episode ends when:**

- a staff reply is accepted. That means an INBOX-sourced message that Meta accepted: the outbound worker writes SENT and emits `message.outbound.sent`, and a status webhook to SENT, DELIVERED or READ is the recovery path.
  - Failed sends, automated acknowledgements, campaigns and API sends never end it.
- the conversation is resolved;
- the contact is blocked;
- the rollout switch is turned off.

A customer message after the ending reply or resolution starts a new episode.

**Precision:** customer messages carry Meta's whole-second timestamp, while staff replies carry milliseconds. A customer message in the same second as a reply can't be ordered, so it counts as still waiting: an enquiry is never silently dropped.

**Snoozed conversations** don't alert until the snooze ends.

**Order of events doesn't matter:**

- Every handler takes a per-conversation advisory lock and re-reads current state.
- A late customer-message event checks for a later accepted staff reply, or a resolution, before opening an episode.

## Checks and delivery

1. `next_check_at` holds when the next alert level can fire.
2. A once-a-minute sweep reads open episodes whose check is due (`system.wait_episodes_due`, X25), bounded by the partial index `conversation_wait_episodes_next_check`.
3. For each episode, the check:
   - re-reads the conversation, settings, schedule and members;
   - fires each due level once per episode (`*_alerted_at`, plus notification dedupe key `wait:{episode}:{level}`);
   - stores the next due time.
4. Events that change which levels apply set `next_check_at = now`. These are assignment, handover and a settings save.

**Severity:** unassigned and no-reply alerts are WARNING; escalation is CRITICAL.

**Content:**

- Bodies hold the customer's display name and the threshold, never message text.
- The link is `/inbox?c={conversation}&ws={workspace}`.

**Restarts:** Postgres is the source of truth. A worker restart or Redis loss only delays the next sweep, and nothing is lost.

## Rollout and rollback

- **Turning alerts on** sets `enabled_at`. A level whose due time is before `enabled_at` is skipped, so turning alerts on never produces historical alerts.
- **Turning alerts off** stops sending; episodes keep being tracked for the waiting indicator.
- **Turning the workspace switch off** ends open episodes at their next check and hides the indicator immediately.
- **Code rollback:** the migration is additive, and the previous release ignores the new tables and the `message.outbound.sent` / `follow_up.scheduled` events. When those events have no subscriber they are marked dispatched.

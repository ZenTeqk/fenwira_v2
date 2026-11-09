# Follow-ups and sales stages

## Scope

Follow-up reminders and lightweight sales opportunities with configurable stages. Both are internal: nothing here sends a WhatsApp message. Missed-enquiry alerts are in [RESPONSE_ALERTS.md](RESPONSE_ALERTS.md); all three share one rollout switch.

Modules: `apps/api/src/modules/sales` (API and the `sales.events` worker processor). Contracts: `packages/contracts/src/api/sales.ts`. Migration: `20261110000000_followups_sales_alerts`.

## Rollout

- **Switch:** `tenants.sales_followups_enabled`, off for every workspace. An OWNER or ADMIN turns it on in **Settings → Workspace → Follow-ups and sales**. The change is audited as `workspace.updated`.
- **While off:**
  - Writes return `403 FEATURE_NOT_ENABLED`. Reads still answer, and return nothing new.
  - The sidebar item and the settings pages are hidden.
  - The worker sends no reminders and opens no waiting episodes.
  - Conversations carry no `waiting` field.
- **Nothing is backfilled.**
  - Stages are created on first use.
  - No opportunity is created for existing conversations.
  - No alert is generated for time that passed before alerts were turned on.
- **Rollback:**
  - Turn the switch off; the data stays in place.
  - Code rollback is the usual release switch. The migration is additive (new enums, tables and one defaulted column), so the previous release runs unchanged against the new schema.

## Permissions

| Permission | Roles | Allows |
| --- | --- | --- |
| `followups.read` | all | See your follow-ups |
| `followups.write` | Owner, Admin, Manager, Agent | Create; complete, reschedule, edit and cancel your own; reassign ones assigned to you |
| `followups.manage` | Owner, Admin, Manager | Team view; act on and reassign anyone's |
| `sales.read` | all | See opportunities and stages |
| `sales.write` | Owner, Admin, Manager, Agent | Create opportunities; change stage, owner and value |
| `sales.stages.manage` | Owner, Admin, Manager | Rename, reorder, add and archive stages |

- **Who sees a follow-up:** a member sees follow-ups assigned to them or created by them. Anything else returns 404.
- **Who can be an assignee or sales owner:** an ACTIVE member of the workspace whose role holds `followups.write` (assignee) or `sales.write` (owner).

## Follow-ups

- **Due times** are stored as UTC instants. They are shown, and entered, in the workspace timezone (`tenants.timezone`, IST today).
- **Default assignee:** the conversation's assignee, else the person creating the follow-up.
- **Tabs:**
  - **Today:** pending and due on the workspace-local date.
  - **Overdue:** pending and past due. A follow-up can be in both Today and Overdue.
  - **Upcoming:** pending and due after today.
  - **Completed:** newest first.
  - Inbox panels also use `tab=pending&scope=related`.
- **Actions:** complete, reschedule, reassign, edit (title and note), mark reviewed, and cancel.
  - Each is audited (`follow_up.*`) and bumps `version`.
  - A request may carry `version`. If the follow-up changed in the meantime, it gets `409 VERSION_CONFLICT`.
  - Completed and cancelled follow-ups can't be changed (`409 CONFLICT`).
- **Customer replies:**
  - A customer message sets `needs_review_at` on the conversation's pending follow-ups, plus the contact's follow-ups that aren't tied to any conversation.
  - It tells each assignee once, and never completes anything.
  - Rescheduling, completing or "Mark reviewed" clears the flag.
- **Resolving a conversation** doesn't touch its follow-ups.

### Reminders

1. Every change that leaves a follow-up pending writes `follow_up.scheduled {followUpId, version}` to the outbox, in the same transaction.
2. `sales.events` turns that event into one delayed BullMQ job, with job id `fudue__{id}__{version}`.
3. When the job runs, it locks the row and notifies the assignee only if all of these hold:
   - the follow-up is still PENDING;
   - `version` is unchanged;
   - it is due;
   - `due_notified_at` is empty.

   The notification has dedupe key `followup.due:{id}:{version}`.

As a result:

- A job armed for an older version (rescheduled, reassigned or edited) does nothing.
- A job for a cancelled or completed follow-up does nothing.
- Duplicate deliveries notify once.

**Recovery:** a once-a-minute sweep (`system.follow_ups_due`, X24) picks up due follow-ups that no job reached, for example after Redis loss or worker downtime. The sweep is bounded by the partial index `follow_ups_due_unnotified`. Reassigning an overdue follow-up clears `due_notified_at`, so the new assignee is told.

**Links:**

- A follow-up's notification opens `/inbox?c={conversation}&ws={workspace}`, or `/follow-ups?task={id}&ws=…` when it isn't tied to a conversation.
- The web app switches to that workspace only when the user is a member of it. Otherwise the parameter is ignored, and the page's own access checks still apply.
- Notification bodies hold the follow-up title and the customer's name, never message text.

## Sales

### Stages

- **Defaults:** each workspace gets five stages the first time one is read.

  | Stage | Outcome |
  | --- | --- |
  | New enquiry | open |
  | Interested | open |
  | Quote sent | open |
  | Won | won |
  | Lost | lost |

  Each default has a stable `key`.
- **Editing:** managers rename, reorder (the full active order), add (open, won or lost) and archive stages.
- **Stability:**
  - Stage ids and outcomes never change.
  - A stage is never deleted.
  - An archived stage stays on past opportunities and can be restored.
- **Archiving is refused when:**
  - it would leave an outcome with no active stage;
  - open opportunities still sit in the stage.
- **Limits:** active names are unique case-insensitively, at most 20 active stages.

### Opportunities

- **Created explicitly**, from the inbox Sales section or the API. A support conversation is never classified as a lead automatically.
- **At most one open opportunity per contact** (partial unique index plus a per-contact lock).
- **Closed opportunities stay as history,** so a repeat purchase starts a new one.
- **Status** follows the stage's outcome: OPEN, WON or LOST, and `closed_at` is set when it closes. It is independent of the conversation's status and assignee.
- **Expected value** is optional: `expected_value_minor BIGINT` with `currency CHAR(3)`, which defaults to the workspace currency.
  - Both are set, or neither.
  - The browser converts typed decimals to minor units with string arithmetic, never floating point.
- **Closing** (moving to a won or lost stage) keeps pending follow-ups by default. `cancelPendingFollowUps: true` cancels them in the same transaction, and each is audited.
- **History:**
  - Stage, owner and outcome changes go to the contact's activity timeline (`opportunity.*`) and to the audit log (`sales.opportunity_*`).
  - The inbox Activity tab shows them.

### Inbox

- **Header:** a "Follow up" icon button, plus the same item in the More menu.
- **Right panel:** two collapsible sections.
  - **Sales:** stage, sales owner, expected value and currency; or a "Create opportunity" button.
  - **Next follow-up:** the soonest pending follow-up, with its due time and assignee, Complete and Edit, and an Add button.
- **List filters** (Advanced filters):
  - Overdue follow-up;
  - sales stage of the open opportunity;
  - sales owner.
- **Waiting indicator:** a list row or header shows "Waiting 12m" when the customer is awaiting a staff reply ([RESPONSE_ALERTS.md](RESPONSE_ALERTS.md)).

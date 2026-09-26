# Campaign Engine

## Scope

Broadcast campaigns: audience definition and snapshot, variable mapping, scheduling, execution, rate limiting, pause/resume/stop/retry, crash recovery and reporting. **Postgres stores campaign truth. Redis only executes.**

## Decisions

### Campaign states

```text
DRAFT ──launch(now)──► RUNNING ──all recipients terminal──► COMPLETED
  │                     │  ▲
  │                     │  └──resume──┐
  │                     └──pause──► PAUSED
  ├──launch(schedule)──► SCHEDULED ──schedule_at reached──► RUNNING
  │                          └──cancel──► DRAFT
  └── any of SCHEDULED/RUNNING/PAUSED/PAUSED_INSUFFICIENT_FUNDS ──stop──► STOPPED (terminal)
RUNNING ──a recipient can't be funded──► PAUSED_INSUFFICIENT_FUNDS ──resume (funds available)──► RUNNING
RUNNING ──fatal (e.g. number disconnected, template disabled)──► FAILED (terminal; remaining recipients stay QUEUED→ SKIPPED)
```

Only DRAFT campaigns can be edited. SCHEDULED campaigns can be cancelled back to DRAFT.

### Audience definition (`packages/contracts/src/campaigns/audience.ts`)

```ts
type CampaignAudience = {
  include: Array<
    | { kind: 'SEGMENT'; segmentId: string }
    | { kind: 'FILTER'; filter: ContactFilter }
    | { kind: 'TAGS'; tagIds: string[]; match: 'ANY' | 'ALL' }
    | { kind: 'CONTACTS'; contactIds: string[] }        // ≤ 10k explicit IDs
    | { kind: 'IMPORT'; importJobId: string }           // contacts from a completed import
  >
  exclude?: Array<same kinds>
}
```

The union of the `include` entries, minus the `exclude` entries, then deduped by contact.

### Estimate (the Review step)

`POST /campaigns/:id/estimate` evaluates the audience **without** snapshotting it and returns:

- the total
- the would-be SKIPPED counts per reason
- the sendable count
- the estimated cost (`sendable × price(category, country)` from the price book, Phase 11; before Phase 11 it returns `null`)
- warnings: phone number quality RED/YELLOW, sendable count above the number's messaging-limit tier, wallet balance below the estimated cost

### Launch

1. Checks: `campaigns.launch` permission, status DRAFT or SCHEDULED-due, template version APPROVED, phone number CONNECTED, variable mapping complete, audience non-empty. From Phase 11, each billable send also reserves its estimated cost (decisions B3 and B4, `BILLING.md` → Reservations).
2. Set status RUNNING (or SCHEDULED if `schedule_at` is in the future), set `launched_by`/`launched_at`, write outbox `campaign.launched`, and audit it. (`Idempotency-Key` is required.)
3. The `campaign.dispatch` processor handles `campaign.launched`:
   - **Snapshot:** evaluate the audience in pages of 1,000 contacts, and insert `campaign_recipients` rows (`ON CONFLICT (campaign_id, contact_id) DO NOTHING`) with the `phone_e164` snapshot and the **resolved variables**. Set `audience_snapshot_at` and `total_recipients`. The snapshot is resumable: it restarts after the last inserted contact ID.
   - **Validation at snapshot:** mark SKIPPED with `skip_reason` for NO_CONSENT (MARKETING category without GRANTED), OPTED_OUT (revoked), BLOCKED, INVALID_PHONE and MISSING_VARIABLE (a mapping resolved empty with no fallback). Recipients are deduped by phone (DUPLICATE).
   - **Dispatch:** enqueue `campaign.dispatch` jobs of type `batch` for QUEUED recipients in pages of 500 (by recipient ID order), with `jobId = jobId('batch', campaignId, firstRecipientId)`.

### Batch processing

For each recipient in the batch, still QUEUED and not yet dispatched:

- Call `MessagingService.send({source: CAMPAIGN, target: {contactId, phoneNumberId}, content: TEMPLATE, idempotencyKey: recipient.idempotency_key, links: {campaignId}})`.
- Set `dispatched_at` and link `message_id`.
- The campaign's status is checked **before each recipient**. If it is PAUSED, PAUSED_INSUFFICIENT_FUNDS or STOPPED, exit the batch early (the remaining recipients stay QUEUED and undispatched).
- Rate limiting has two layers:
  1. Campaign pacing: `rate_limit_per_minute` (optional, per campaign), enforced by a BullMQ group limiter keyed on the campaign.
  2. The per-number token bucket in the outbound worker (a hard limit shared with inbox traffic). Inbox and automation sends get priority: outbound jobs from campaigns get `priority: 10` (lower priority), and inbox gets `priority: 1`.

### Recipient status

`QUEUED → SENT → DELIVERED → READ`, or `FAILED`, or `SKIPPED` (set at snapshot only).

- Recipient status is **derived from message status** by the `campaign.events` processor on `message.status.changed` (where `message.campaign_id` is set). It uses the same ordering rule as messages.
- A `MessagingService.send` rejection at dispatch time (for example consent revoked since the snapshot) marks the recipient FAILED with that error code.

### Completion

The `campaign.events` processor checks after each terminal recipient update, debounced to once per 5 s per campaign, and the maintenance job checks too. When no recipient is QUEUED with `dispatched_at` null **and** no dispatched recipient's message is in a pre-SENT state, the campaign becomes COMPLETED and emits `campaign.completed`. DELIVERED and READ keep updating after completion. Stats stay live.

### Insufficient funds (decision B4)

When a running campaign reaches a recipient whose reservation is refused (`INSUFFICIENT_BALANCE`):

1. The campaign is **not** failed.
2. No further billable recipients are enqueued. The dispatcher stops at that recipient, which stays QUEUED and undispatched.
3. The status becomes `PAUSED_INSUFFICIENT_FUNDS`, with an audit entry and a `campaign.progress` event.
4. Recipients already sent or completed keep their states.
5. Remaining unsent recipients are preserved as QUEUED.
6. The UI shows a `danger` banner on the campaign ("Paused: not enough credits. Add credits, then resume."), and the list shows the status badge.
7. **Resume** is allowed once the available funds cover at least the next recipient. It re-enqueues from the preserved recipients. If funds still fall short, the resume is refused with `INSUFFICIENT_BALANCE`.

### Controls

| Action | Effect |
| --- | --- |
| Pause | Status PAUSED. Batches stop at the next recipient. Messages already created (≥ CREATED) continue to Meta. |
| Resume | From PAUSED or PAUSED_INSUFFICIENT_FUNDS: status RUNNING. Re-enqueue dispatch batches for QUEUED recipients without `dispatched_at`. |
| Stop | Status STOPPED (terminal). Undispatched QUEUED recipients → SKIPPED (`STOPPED`). |
| Retry failed | Only when COMPLETED/PAUSED/RUNNING. Recipients FAILED with a **retryable** error code are reset to QUEUED (`attempts++`, new idempotency key suffix `:r{attempts}`) and re-dispatched. Permanent failures are never retried. |

All controls are audited and emit WS `campaign.progress`.

### Crash recovery

- On worker boot, and every minute (the maintenance job), for every RUNNING campaign (found through `system.*`-style ID fan-out per tenant): if QUEUED undispatched recipients exist and no active dispatch job exists for the campaign, re-enqueue the batches. The deterministic `jobId`s make this idempotent.
- The snapshot and dispatch are both resumable from Postgres state, so losing Redis entirely loses no campaign state.

### Scheduling

`schedule_at` plus the IANA `timezone`. The `system.due_scheduled_campaigns(now)` scan runs every 30 s and moves SCHEDULED campaigns to RUNNING by writing outbox `campaign.launched`. An optional `send_window` (for example 09:00–21:00 in the campaign timezone) pauses dispatch outside the window: batches are delayed until the window opens.

### Variable mapping

```ts
type VariableMapping = {
  header?: VariableSource[]; body: VariableSource[]; buttons?: Record<number, VariableSource[]>
}
type VariableSource =
  | { kind: 'FIELD'; field: 'name' | 'firstName' | 'phone' | 'email' | 'country'; fallback?: string }
  | { kind: 'PROPERTY'; key: string; format?: 'DATE_SHORT' | 'DATE_LONG' | 'NUMBER'; fallback?: string }
  | { kind: 'STATIC'; value: string }
```

`firstName` is the first token of `name`. Values are resolved at snapshot and stored on the recipient, so a later contact edit doesn't change what is sent.

### Reporting

- Live counts come from `SELECT status, count(*) FROM campaign_recipients WHERE campaign_id = $1 GROUP BY status` (indexed), cached for 2 s.
- The dashboard shows Recipients, Sent, Delivered, Read, Failed and Skipped (with rates against the sendable count), plus a funnel, failure reasons grouped by `error_code` with human titles, and skip reasons.
- The recipient table supports status and skip-reason filters and CSV export (`contacts.export`).

### Scope boundaries (decisions)

- Campaigns are **immediate or one-time scheduled** (`schedule_at`). No recurring campaigns in v2 (CE2).
- No A/B testing or split templates in v2 (CE1).

## Open questions

None. Resolved in the specification freeze (2026-09-26); see `PRODUCT.md` → Decision register.

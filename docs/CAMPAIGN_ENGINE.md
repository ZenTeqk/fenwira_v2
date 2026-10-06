# Campaign Engine

## Scope

Broadcast campaigns: audience definition and snapshot, variable mapping, scheduling, execution, rate limiting, pause/resume/stop/retry, crash recovery and reporting. **Postgres stores campaign truth. Redis only executes.**

## Decisions

### Campaign states

```text
DRAFT ──launch(now)──► PREPARING ──snapshot done──► RUNNING ──nothing pending or awaiting Meta──► COMPLETED
  │                        │                         │  ▲
  │                        │                         │  └──resume──┐
  │                        │                         ├──pause──► PAUSED (reason MANUAL | NUMBER_UNAVAILABLE)
  │                        │                         ├──a recipient can't be funded──► PAUSED_INSUFFICIENT_FUNDS
  │                        │                         └──template paused/disabled/deleted/changed──► PAUSED_TEMPLATE_UNAVAILABLE
  ├──launch(schedule)──► SCHEDULED ──schedule_at reached──► PREPARING
  │                          └──unschedule──► DRAFT
  └── SCHEDULED / PREPARING / RUNNING / any PAUSED_* ──cancel──► CANCELLED (terminal)
```

Only DRAFT campaigns can be edited or deleted. FAILED is only for campaign-level faults unrelated to Meta's template state; recipient-level failures never fail the campaign.

**Template unavailable (decision P9-D3).** When the template is paused, disabled, deleted or superseded during a run, the campaign moves to `PAUSED_TEMPLATE_UNAVAILABLE`. Processed recipients keep their states; the rest stay PENDING and are not sent. Resume works only when the same frozen template version is sendable again. A campaign never switches templates: for another template or version, cancel it and create a new campaign for the remaining audience. `template_snapshot` and `messages.template_version_id` record what was sent.

### Recipient states

`PENDING` (snapshotted, not yet handed to MessagingService) → `QUEUED` (message accepted) → `SENDING` → `SENT` → `DELIVERED` → `READ`, or `FAILED`, or `SKIPPED` with a machine-readable reason: `NO_MARKETING_CONSENT`, `OPTED_OUT`, `INVALID_PHONE`, `BLOCKED`, `TEMPLATE_UNAVAILABLE`, `TEMPLATE_NOT_APPROVED`, `MISSING_VARIABLE`, `OTHER_POLICY_RESTRICTION` or `CANCELLED`. Transitions only move forward (duplicate and late webhooks are no-ops), and FAILED and SKIPPED are terminal.

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
2. Set status PREPARING (or SCHEDULED if `schedule_at` is in the future), freeze `template_snapshot`, set `launched_by`/`launched_at`, write outbox `campaign.launched`, and audit it. (`Idempotency-Key` is required.)
3. The `campaign.dispatch` processor handles `campaign.launched`:
   - **Snapshot:** evaluate the audience in pages of 1,000 contacts, and insert `campaign_recipients` rows (`ON CONFLICT (campaign_id, contact_id) DO NOTHING`) with the `phone_e164` snapshot and the **resolved variables**. Set `audience_snapshot_at` and `total_recipients`. The snapshot is resumable: it restarts after the last inserted contact ID.
   - **Validation at snapshot:** mark SKIPPED with `skip_reason` for NO_CONSENT (MARKETING category without GRANTED), OPTED_OUT (revoked), BLOCKED, INVALID_PHONE and MISSING_VARIABLE (a mapping resolved empty with no fallback). Recipients are deduped by phone (DUPLICATE).
   - **Dispatch:** the campaign becomes RUNNING and a chain of `campaign-dispatch` jobs takes PENDING recipients in batches by id (see Implementation notes).

### Batch processing

For each recipient in the batch, still PENDING:

- Call `MessagingService.send({source: CAMPAIGN, target: {contactId, phoneNumberId}, content: TEMPLATE, idempotencyKey: recipient.idempotency_key, links: {campaignId}})`.
- Set status QUEUED, `queued_at` and link `message_id`.
- The campaign's status is checked **before each chunk of parallel sends**. If it is no longer RUNNING, the batch exits early and the remaining recipients stay PENDING.
- Rate limiting has two layers:
  1. Campaign pacing: `rate_limit_per_minute` (optional, per campaign), enforced by a BullMQ group limiter keyed on the campaign.
  2. The per-number token bucket in the outbound worker (a hard limit shared with inbox traffic). Inbox and automation sends get priority: outbound jobs from campaigns get `priority: 10` (lower priority), and inbox gets `priority: 1`.

### Recipient status

`PENDING → QUEUED → SENT → DELIVERED → READ`, or `FAILED`, or `SKIPPED` (at snapshot, or at send time when MessagingService refuses that recipient).

- Recipient status is **derived from message status** by the `campaign.events` processor on `message.status.changed` (where `message.campaign_id` is set). It uses the same ordering rule as messages.
- A `MessagingService.send` refusal at dispatch time (for example consent revoked since the snapshot) marks the recipient SKIPPED with the reason and the error code.

### Completion

The `campaign.events` processor checks after each terminal recipient update, debounced to once per 5 s per campaign, and the maintenance job checks too. When no recipient is PENDING, QUEUED or SENDING, the campaign becomes COMPLETED and emits `campaign.completed`. DELIVERED and READ keep updating after completion. Stats stay live.

### Insufficient funds (decision B4)

When a running campaign reaches a recipient whose reservation is refused (`INSUFFICIENT_BALANCE`):

1. The campaign is **not** failed.
2. No further billable recipients are handed to MessagingService. The dispatcher stops at that recipient, which stays PENDING.
3. The status becomes `PAUSED_INSUFFICIENT_FUNDS`, with an audit entry and a `campaign.progress` event.
4. Recipients already sent or completed keep their states.
5. Remaining unsent recipients are preserved as PENDING.
6. The UI shows a `danger` banner on the campaign ("Paused: not enough credits. Add credits, then resume."), and the list shows the status badge.
7. **Resume** is allowed once the available funds cover at least the next recipient. It re-enqueues from the preserved recipients. If funds still fall short, the resume is refused with `INSUFFICIENT_BALANCE`.

### Controls

| Action | Effect |
| --- | --- |
| Pause | Status PAUSED. Batches stop at the next recipient. Messages already created (≥ CREATED) continue to Meta. |
| Resume | From PAUSED or PAUSED_INSUFFICIENT_FUNDS: status RUNNING. Re-enqueue dispatch batches for QUEUED recipients without `dispatched_at`. |
| Cancel | Status CANCELLED (terminal). Recipients still PENDING → SKIPPED (`CANCELLED`). |
| Unschedule | SCHEDULED → DRAFT. |
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

### Implementation notes (Phase 9)

- **Code map.** `apps/api/src/modules/campaigns`: `CampaignsService` (drafts, estimate, launch, controls, stats, recipients, CSV export), `campaigns.core.ts` (audience → Prisma where, keyset pages, variable resolution, classification, stats), `CampaignDispatchProcessor` (queue `campaign.dispatch`: prepare, dispatch, scheduler, recovery, completion) and `CampaignEventsProcessor` (queue `campaign.events`: recipient status from `message.status.changed`). Contracts: `packages/contracts/src/campaigns/campaigns.ts`.
- **Every send goes through `MessagingService`** with `source CAMPAIGN`, `campaignId`, the approved template version, the recipient's stored variables, and the idempotency key `campaign:{campaignId}:{recipientId}`. Retries, duplicate jobs and a worker crash can therefore never send twice.
- **Snapshot.** Launch freezes the template (`template_snapshot`) and the audience cut-off (`audience_snapshot_at`). `prepare` pages contacts by id (1,000 per transaction) that were created up to the cut-off, resolves variables, and classifies each contact with the same `evaluateEligibility` rules the send uses. The consent/opt-out distinction comes from MessageEligibilityService's `optedOut`, and phone validity and missing values are checked too. Recipients are inserted with `ON CONFLICT DO NOTHING`, so a crashed snapshot resumes after the last contact id.
- **Dispatch.** Jobs take `CAMPAIGN_BATCH_SIZE` (default 50) PENDING recipients by id. They send in parallel chunks of 10, re-checking the campaign status before each chunk; a pause stops at most one chunk of in-flight sends. The next batch is delayed to respect `rate_limit_per_minute`, and the outbound worker's per-number token bucket still applies. A resume increments `dispatch_generation`, which starts a fresh job chain. Stale chains exit.
- **Refusals.** At send time, `INSUFFICIENT_BALANCE` → PAUSED_INSUFFICIENT_FUNDS, `NO_CONNECTED_NUMBER` → PAUSED (NUMBER_UNAVAILABLE), and `TEMPLATE_NOT_APPROVED` → PAUSED_TEMPLATE_UNAVAILABLE (P9-D3). Any other refusal (for example consent revoked after the snapshot) skips just that recipient, with its reason.
- **Scheduling and recovery.** Every 30 s, X4 lists due campaigns, and a conditional `SCHEDULED → PREPARING` update plus the outbox event (one transaction) make exactly one scheduler win. Every 60 s, X15 lists PREPARING/RUNNING campaigns: recovery re-drives them, reconciles QUEUED recipients from their messages (a missed webhook), and completes finished campaigns. A debounced check also runs after each recipient update.
- **Stats.** Grouped counts per status, skip reason and error code. Delivery rate = delivered or read ÷ (sent + failed); read rate = read ÷ delivered or read; failure rate = failed ÷ (sent + failed). The detail page keeps refreshing for an hour after completion, because receipts keep arriving.
- **Metrics** (no tenant labels): `campaign_recipients_total{outcome}`, `campaign_dispatch_batches_total{result}`, `campaign_job_retries_total`, `campaign_duration_seconds`, plus `queue_depth{queue="campaign.dispatch"|"campaign.events"}`.
- **Measured:** a 2,000-recipient campaign completes in about 115 s against the local mock (batch size 10 in the test, Docker on a laptop), which is roughly 17 recipients per second. Per-batch overhead dominates; see ROADMAP known limitations.
- **Backlog** (`PRODUCT.md`): send windows, retrying failed recipients, individual-contact selection in the UI, inbox priority over campaigns, throughput optimization, template replacement/migration.

### Scope boundaries (decisions)

- Campaigns are **immediate or one-time scheduled** (`schedule_at`). No recurring campaigns in v2 (CE2).
- No A/B testing or split templates in v2 (CE1).

## Open questions

None. Resolved in the specification freeze (2026-09-26); see `PRODUCT.md` → Decision register.

## Experience V2 campaign operations

Campaigns prioritize active/scheduled/paused communications and then focused history/drafts. Cards and rows use existing inclusive counts and server-defined rates; unknown denominators remain “—”. Audience-source summaries do not invent names from stored IDs. Snapshot-free campaigns explain that the audience is prepared at launch. Funding and template pauses link to existing recovery workflows without changing remaining recipients or the frozen template. The detail route retains controls, recipient results and export. See [Batch 2 evidence](design/EXPERIENCE_V2_BATCH_2.md) for responsive, keyboard, accessibility and operational regression results.

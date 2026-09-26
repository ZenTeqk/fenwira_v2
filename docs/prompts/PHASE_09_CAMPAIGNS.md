# Phase 9 — Campaign / Broadcast Engine

**Goal:** large campaigns can be stopped, resumed, retried and audited without losing state. Postgres stores campaign truth. Redis only executes.

**Read:** `AGENTS.md`, `docs/CAMPAIGN_ENGINE.md`, `docs/MESSAGING_ENGINE.md`, `docs/CONTACTS_AND_CONSENT.md`.

## Build

1. **Entities:** `Campaign` (name, template version, variable mapping, audience definition, schedule + timezone, status ∈ DRAFT/SCHEDULED/RUNNING/PAUSED/PAUSED_INSUFFICIENT_FUNDS/STOPPED/COMPLETED/FAILED (the funds pause is entered from Phase 11, decision B4), created_by, launched_by) and `CampaignRecipient` (contact, resolved variables, status ∈ QUEUED/SENT/DELIVERED/READ/FAILED/SKIPPED, skip_reason, message_id, idempotency key `campaign:{id}:contact:{id}`).
2. **Wizard (6 steps):**
   1. Audience: contact list, saved segment, CSV (imported via the Phase 6 pipeline), tags, or filters, with a live count.
   2. Template: approved only.
   3. Variables: map `{{n}}` → contact field, custom property or static text, with a fallback value and a per-contact preview.
   4. Schedule: now or at a time, with timezone and an optional send window.
   5. Review: counts, estimated cost (from Phase 11 pricing, or a placeholder until then), and the consent exclusions shown explicitly.
   6. Launch: needs `campaigns.launch` and a confirm dialog.
3. **Execution:**
   - Launch **snapshots the audience** into `CampaignRecipient` rows in batches.
   - Validation marks SKIPPED with a reason for: no marketing consent, invalid phone, duplicate, missing required variable.
   - `campaign.dispatch` enqueues batches (for example 500).
   - The rate limiter is a per-phone-number token bucket in Redis, respecting the Meta tier and a tenant-configurable cap.
   - Workers call `MessagingService.send({source: 'campaign', idempotencyKey})`.
   - Recipient status follows message status through domain events, not direct coupling.
4. **Controls:**
   - Pause stops dispatching new batches; in-flight sends complete.
   - Resume continues from Postgres state.
   - Stop is terminal.
   - Retry failed re-queues only retryable FAILED recipients.
   - Crash recovery: on worker start, reconcile RUNNING campaigns from recipient rows.
5. **Dashboard:** recipients, sent, delivered, read, failed and skipped counts (live), a funnel, failure reasons grouped by code, and a recipient table with filters and a CSV export. Contact 360 → Campaigns tab is populated.

## Acceptance criteria

- [ ] A 10k-recipient campaign against a mocked Meta endpoint completes with the counts exactly matching the recipient rows.
- [ ] Pause at about 40%, then resume, gives zero duplicates and zero lost recipients.
- [ ] Killing the workers and Redis mid-run, then restarting, lets the campaign resume from Postgres, and no contact receives two messages (idempotency test).
- [ ] Contacts without consent are SKIPPED, with that reason shown in the Review step and the report.
- [ ] Throughput never exceeds the configured rate limit (measured).

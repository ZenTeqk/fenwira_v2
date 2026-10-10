# Phase 10 implementation plan: Automation and Flow Builder

**Status:** approved (2026-09-26) with decisions P10-D1–D4 (below, and ADR-0025); implemented on branch `phase-10-automation` (see `ROADMAP.md` → Phase 10 verification). Where this plan and the approved decisions differ (§9 takeover, §10 funds, §13 queue table), the decisions and `AUTOMATION_ENGINE.md` → Implementation are authoritative.
**Inputs:** `docs/AUTOMATION_ENGINE.md`, `docs/prompts/PHASE_10_AUTOMATION.md`, `docs/DATABASE.md` → Automation, `docs/API_SPEC.md` → Automation, ADR-0022/0023 (AE1–AE3), and the Phase 0–9 code as it stands.

Principle: the automation engine is an **orchestrator of existing services**. It adds no send path, consent logic, template resolution, queue runtime, RLS pattern or realtime channel of its own.

| Existing piece | How Phase 10 uses it |
| --- | --- |
| `MessagingService.send` | The only way `send_message` / `send_template` deliver (source `AUTOMATION`) |
| `MessageEligibilityService` | Evaluated inside MessagingService; skip reasons map as in campaigns |
| `resolveTemplateForSend` (templates) | `send_template` resolves the template's current APPROVED version at run time |
| Takeover (`automation_state`) | Gate for triggers, sends and trigger-run continuation |
| Wallet reservations (billing) | Automatic: template sends reserve inside MessagingService |
| Outbox → BullMQ (`@fenwira/queue`, worker runtime) | Trigger fan-out and step execution |
| RLS / `withTenant` / `system.*` | Every table tenant-scoped; cross-tenant scans only via named system functions |
| `RealtimeEmitter` | Live execution/timeline updates to `tenant:{id}` |
| `FilterCompiler`, tags, properties (contacts) | Conditions and `update_contact` / tag actions |
| Inbox round-robin (`InboxEventsProcessor.autoAssign`) | Extracted into a shared function for `assign_agent: ROUND_ROBIN` |

---

## 1. Automation domain model

Module `apps/api/src/modules/automation` (API and worker sides, like campaigns). Contracts in `packages/contracts/src/automation/`:

- `graph.ts`: `FlowGraph`, the node catalog (a discriminated union of node configs), edge handles.
- `validate.ts`: `validateFlowGraph(graph, refs?)`, shared by the builder and the API (the same pattern as `validateTemplate`).
- `expressions.ts`: the `Expr` parser and pure `evaluate(expr, context)` (no eval).
- `api.ts`: DTOs for flows, versions, executions, steps and trigger runs.

Permissions already exist: `automations.read`, `automations.write`, `automations.publish`.

## 2. Flow / FlowVersion model

Tables exactly as drafted in `DATABASE.md` → Automation (P10), with these additions:

- `flows.priority int default 100` (AE2), `reentry_policy`, `webhook_token_hash` (unique), `webhook_secret_ciphertext` (HMAC secret, app crypto).
- `flow_versions.graph` (FlowGraph), plus denormalized `trigger_type` and `trigger_config` for indexed matching; `state` DRAFT/PUBLISHED/ARCHIVED; `validation_errors`.
- `automation_executions` pins `flow_version_id`; the partial unique `(flow_id, conversation_id) WHERE status IN ('RUNNING','WAITING')` enforces AFTER_COMPLETION re-entry. For contact-only triggers (contact created, webhook), a second partial unique on `(flow_id, contact_id)` applies to the same statuses.
- `automation_trigger_runs` (AE3: the per-event plan) and `automation_execution_steps` (append-only, `unique (execution_id, seq)`).

Lifecycle: a flow has at most one DRAFT version and one PUBLISHED version. "Edit" copies the published graph into a new DRAFT. Publishing validates → marks the draft PUBLISHED → archives the previous version → sets `active_version_id`, in one transaction, audited. The draft is saved with `PUT /flows/:id/draft` using `If-Match` (optimistic concurrency on `updated_at`), so two editors can't silently overwrite each other.

## 3. Trigger architecture

- Subscriptions: `message.inbound.received` and `contact.created` → `automation.trigger` (new subscriptions in `EVENT_SUBSCRIPTIONS`). The webhook trigger is a public route `POST /api/v1/webhooks/automation/:token` → X8 `system.resolve_flow_webhook(token_hash)` → an HMAC check (`X-Fenwira-Signature`) when required → an outbox event `automation.webhook.received` → the same processor.
- Matching (worker, `withTenant`): load PUBLISHED versions of ACTIVE flows with the indexed `trigger_type`, evaluate each trigger config (keyword match modes, phone number filter, `onlyNewConversation`, contact sources), then apply keyword-over-message-received precedence.
- Gates before a run starts: the conversation's `automation_state` must be `AUTOMATION_ACTIVE` for message triggers, and the re-entry policy is checked per flow (SKIPPED with a reason).
- **Idempotency:** `automation_trigger_runs.event_id` is unique (the outbox event id), so a redelivered event creates no second run.

## 4. Condition engine

Pure functions over an **execution context** loaded in the step transaction: the contact (fields, properties, tags), the conversation, the trigger payload, and `vars` (webhook responses).

- `condition.equals` / `contains` / `exists`: `Expr` subject vs value, with optional case sensitivity.
- `condition.has_tag`: ANY/ALL over tag ids, read in the step transaction.
- `condition.contact_property`: reuses the Phase 6 filter operators by compiling a one-rule `ContactFilter` through `FilterCompiler` and checking `contact.id ∈ result` (one indexed query, no second DSL implementation).

Output: the `yes` or `no` handle. No randomness and no wall-clock reads.

## 5. Action engine

One handler per node type, registered in a table. Each returns `{ handle: 'next' | 'error', output }` or `{ wait: Date }`.

| Action | Implementation |
| --- | --- |
| `send_message` | `MessagingService.send({source: AUTOMATION, content: TEXT or media, idempotencyKey: auto:{executionId}:{seq}})`; the service window and eligibility are enforced there |
| `send_template` | Same path with `{templateVersionId: current APPROVED of templateId, variables}`; variables resolved from `Expr`/VariableMapping (the campaign resolver is reused where the shapes match) |
| `add_tag` / `remove_tag` | DB writes in the step transaction, plus `addActivity` |
| `assign_agent` | `assignConversation` (inbox.core) for a user; the shared round-robin picker for ROUND_ROBIN |
| `update_contact` | Contacts service primitives (field and property upsert, activity) in the step transaction |
| `webhook` | Outbound HTTP outside the transaction; https only, an SSRF guard (DNS-resolved private/loopback/link-local ranges blocked), timeout ≤ 10 s, response size cap, an optional `saveResponseAs` → `vars`; at-least-once (documented) |
| `delay` | `{ wait }` → WAITING + a delayed job |
| `end` | Completes the execution |

Refusals from MessagingService follow the `error` edge when one exists, otherwise the execution fails with the error code (`CONSENT_REQUIRED`, `CONVERSATION_WINDOW_CLOSED`, `INSUFFICIENT_BALANCE`, `TEMPLATE_NOT_APPROVED`, …). `AUTOMATION_BLOCKED_BY_TAKEOVER` is special (§9).

## 6. Deterministic priority execution (AE2/AE3)

- The plan is ordered by `priority ASC, created_at ASC, id ASC` and stored on the trigger run with per-flow status PENDING/STARTED/COMPLETED/FAILED/SKIPPED/STOPPED.
- **Sequential, never concurrent:** the run starts flow #1. When its execution reaches a terminal state, `advanceTriggerRun` runs in the same transaction as the terminal update and starts the next PENDING flow. A flow still waiting in a delay therefore blocks later flows for that event, as ADR-0023 specifies.
- Stop conditions checked at each advance: the conversation is no longer `AUTOMATION_ACTIVE` (remaining flows → STOPPED, `stop_reason = AGENT_TAKEOVER | AUTOMATION_PAUSED`). A future exclusive flow hooks in at the same point.
- Determinism test: replaying the same event against a fixture DB twice gives identical plans and step sequences.

## 7. Execution history

- Each step writes an `automation_execution_steps` row: seq, node, type, status SUCCEEDED/FAILED/SKIPPED/WAITING, redacted input/output and the error.
- API: `GET /flows/:id/executions` (status, contact, version, duration), `GET /executions/:id` (steps), and `GET /flows/:id/trigger-runs/:runId` (the plan, with matched, skipped and stopped flows and their reasons).
- The UI timeline (✓ ✗ ⏸ ⤼) and "Show on canvas" (the pinned version read-only, traversed edges `primary`). PII in step input/output is redacted unless the viewer has `automations.write`.

## 8. Retries and idempotency

- Each job processes one execution: `jobId = exec:{executionId}:{stepCount}`. A redelivered job for an already-processed step finds `seq` taken and resumes from the stored step (no duplicate effect).
- DB effects are committed with their step row; sends are idempotent by `auto:{executionId}:{seq}`; webhooks commit a WAITING step before the call and update it after (at-least-once).
- Infrastructure errors (DB, Redis) → BullMQ retries (3, exponential). Business errors → the error edge or FAILED, never retried.
- Loop guard: 500 steps per execution (`FLOW_STEP_LIMIT`); at most 25 steps per job, then yield by re-enqueueing.

## 9. Human-takeover interaction

- Triggers: message-based flows don't start while the conversation is in takeover or paused.
- Sends: MessagingService rejects `source AUTOMATION` during takeover (already built). The step is recorded **SKIPPED** with `AUTOMATION_BLOCKED_BY_TAKEOVER`; the execution ends COMPLETED with that `error_code`; the trigger run STOPs the remaining flows with `stop_reason AGENT_TAKEOVER`. (The spec says an execution never waits for takeover to end. The prompt's "waits or ends per config" is resolved as "ends"; see the questions.)
- `conversation.automation_state.changed` stays unsubscribed in v1 (reserved).

## 10. Wallet integration

No new billing code: `send_template` (billable) reserves inside MessagingService when the tenant's billing mode is enforced (P9-D1). `INSUFFICIENT_BALANCE` is a business refusal: it follows the `error` edge or fails the execution with that code, and is visible in the history. Nothing is retried automatically (see the questions).

## 11. React Flow builder architecture

- Dependencies (exact versions, ADR-0019; a settled release, not one published this week): `@xyflow/react` 12.x and `@dagrejs/dagre` 3.x (auto-layout).
- `apps/web/components/automation/`:
  - `FlowCanvas` (React Flow with custom nodes per category, colors from `DESIGN_SYSTEM.md`);
  - `NodePalette` (drag, or keyboard "Add node");
  - `NodeInspector` (a side panel with forms per node type, driven by the contracts' Zod schemas and reusing TemplatePicker, tag pickers and the expression field with `{{…}}` chips);
  - `ValidationPanel` (the shared `validateFlowGraph` runs live, and nodes carry error badges);
  - `ExecutionTimeline` and a read-only replay overlay.
- Conversion at the UI boundary: React Flow state ↔ `FlowGraph` (the server never stores React Flow internals).
- **Accessibility:** canvases are hard for keyboard and screen-reader users, so the builder also offers an **Outline** view: an ordered, fully keyboard-operable list of nodes and their branches with the same inspector. axe checks run on the builder, the outline and the history.

## 12. Validation and publish lifecycle

`validateFlowGraph` (shared) enforces the `AUTOMATION_ENGINE.md` table. The server adds reference checks (tags, users, properties, and templates with an APPROVED version, via one query each). `POST /flows/:id/validate` is a dry run; `POST /flows/:id/publish` (**IK**, `automations.publish`) refuses with 422 `FLOW_INVALID` and the per-node errors. Pause and resume stop new executions only; WAITING executions re-check the flow status when they wake and re-delay by 1 minute while it's paused. Cancelling an execution is terminal and advances its trigger run.

## 13. Queue architecture

| Queue | Producer | Work |
| --- | --- | --- |
| `automation.trigger` (exists) | Outbox relay (`message.inbound.received`, `contact.created`, `automation.webhook.received`) | Match flows, create the trigger run, start flow #1 |
| `automation.execute` (exists) | Trigger processor, the step loop, delayed jobs, recovery | Interpret steps for one execution |
| — (scheduler on `automation.execute`) | Repeatable every 60 s | Recovery: X16 `system.due_automation_executions(now, limit)` finds WAITING executions past `wait_until` (Redis lost the delayed job) and RUNNING executions idle too long, then re-enqueues them with deterministic job ids |

## 14. Tenant isolation

Every new table has `tenant_id` and RLS (the post-migrate loop plus the CI check); tenant-matrix fixtures for the 5 new tables (steps are append-only); the security matrix covers every new route automatically. Cross-tenant code paths: only X8 (webhook token → tenant, flow) and X16 (IDs only). Webhook trigger tokens are 256-bit, stored as a hash; the HMAC secret is encrypted.

## 15. Failure recovery

- Worker crash mid-step: the job retries, the step row guards against duplicate effects, and the send is idempotent.
- Crash during a delay: the delayed job survives in Redis; if Redis lost it, X16 recovery re-enqueues it (acceptance test: kill the worker during a delay → resume with no duplicated step).
- A failed webhook call follows the error edge. A deleted template or tag referenced by a published flow fails that step with `FLOW_REFERENCE_MISSING` (error edge).
- Trigger-run consistency: advancing to the next flow happens in the same transaction as the terminal state, so a crash can't leave a run stuck. Recovery also finds runs whose current execution is terminal but not advanced.

## 16. Observability

- Metrics (no tenant labels): `automation_trigger_runs_total{result}`, `automation_executions_total{status}`, `automation_steps_total{node_type,status}`, `automation_step_duration_seconds{node_type}`, `automation_job_retries_total`, and `queue_depth` for both queues.
- Structured logs carry `executionId`, `flowId`, `versionId`, `seq` and the correlation id from the triggering event.
- Realtime `automation.execution.updated` to `tenant:{id}` for the live timeline; audit entries for publish, pause, resume, archive, webhook-token rotation and execution cancel.

## 17. Test strategy

- **Unit (contracts, api):**
  - the graph validator (every rule, with pinpointed node ids);
  - the expression evaluator (paths, missing values, no code execution);
  - condition functions;
  - the plan ordering (priority, created_at, id);
  - the interpreter over an in-memory fixture for determinism;
  - the SSRF guard.
- **Integration (worker, against the meta-mock):**
  1. Determinism: the same trigger and data twice → identical step sequences.
  2. AE3: three matching flows (10, 20, 30) run in order, one at a time; takeover during the first → the other two STOPPED with the reason in the history.
  3. Publishing v2 while v1 executions sit in a delay → they finish on v1; new triggers use v2.
  4. An agent reply mid-flow → takeover → the next automation send is refused and recorded (SKIPPED, `AUTOMATION_BLOCKED_BY_TAKEOVER`).
  5. A worker crash during a delay, plus Redis-loss recovery via X16 → resumes once, no duplicated step.
  6. Validation blocks publishing and pinpoints nodes.
  7. Keyword-over-message precedence; re-entry policies (ALWAYS, ONCE_PER_CONTACT, AFTER_COMPLETION); the loop guard; cancel.
  8. The webhook trigger: token, signature, contact found or created, 202 with the execution id; wrong signature → 401.
  9. Sends go through MessagingService only (source AUTOMATION, idempotent key); eligibility refusals follow error edges; `INSUFFICIENT_BALANCE` with billing enforced.
  10. Tenant isolation: another tenant can't read, publish, pause, cancel or view executions (404), and can't trigger A's flows through events or webhook tokens.
- **e2e (Playwright):** build a flow in the canvas (keyword trigger → condition → send message), see inline validation, publish, simulate an inbound keyword through the mock → the reply appears in the inbox and the execution timeline shows the path; the same flow edited through the Outline view by keyboard only. axe on the builder, outline, list and history pages; Lighthouse accessibility on the flows list and builder.
- **Regression:** the full Phase 0–9 suite, and OpenAPI regeneration and check.

## Approved decisions (2026-09-26)

- **P10-D1, insufficient funds.** A billable send that can't reserve funds records `INSUFFICIENT_FUNDS`, then follows the node's error branch if configured, otherwise fails the execution. It is never retried as a transient error and never waits for credits. A "Wait for Funds" capability may be designed separately later.
- **P10-D2, human takeover.** Takeover **terminates** the current execution as `STOPPED_TAKEOVER`. No further actions run; the event's remaining matched flows are recorded `SKIPPED_TAKEOVER`; nothing resumes when takeover ends (a new qualifying event starts a new execution normally). Takeover is detected before every step, on send refusal, when a delay wakes, and immediately on `conversation.automation_state.changed`. History distinguishes FAILED, CANCELLED, STOPPED_TAKEOVER and SKIPPED_TAKEOVER.
- **P10-D3, entitlements.** No plan names or commercial limits in code. A single entitlement boundary (`EntitlementsService`, backed by a replaceable source) is consulted for `automation_enabled` and `max_active_flows` at publish and `automation_execution_limit` at execution start. Phase 10 ships an allow-all source; Phase 11 plugs in plan data.
- **P10-D4, outbound webhook security.** HTTPS only in production. SSRF protection blocks loopback, private, link-local, CGNAT, multicast/reserved, cloud metadata and internal hostnames. DNS is resolved once and the connection is pinned to the validated address (no rebinding); every redirect hop is re-validated (limit 3). Connect and response timeouts, a response-size cap, GET/POST only, and secret header values redacted from history and logs. A development exception (`AUTOMATION_WEBHOOK_DEV_HOSTS`, refused when `NODE_ENV=production`) allows named local hosts for simulated receivers.

## Questions answered (see Approved decisions)

1. **Insufficient funds in automation:** should a template send that can't be funded follow the error edge / fail the execution (proposed), or wait and retry once funds arrive?
2. **Takeover mid-flow:** confirm "the execution ends (COMPLETED with `AUTOMATION_BLOCKED_BY_TAKEOVER`) and the remaining flows of that event stop", per `AUTOMATION_ENGINE.md`, rather than the prompt's "waits or ends per config".
3. **Plan entitlements** (`automation_enabled`, `max_active_flows`): enforce in Phase 10, or leave them to Phase 11 with the rest of the plans (proposed: Phase 11)?
4. **Outbound webhook action:** https only with private-network blocking (proposed). Are any customers expected to call plain-http endpoints?

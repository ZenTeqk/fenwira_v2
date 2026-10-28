# Automation Engine

## Scope

Visual automation flows: the node catalog and config schemas, the graph format, versioning and publishing, triggers, execution semantics, determinism, takeover interaction, and execution history.

## Decisions

### Flow and version lifecycle

```text
Flow:         DRAFT ──first publish──► ACTIVE ◄──resume── PAUSED
                                         └──pause──►┘
              any ──archive──► ARCHIVED (no new executions; running ones finish)

FlowVersion:  DRAFT ──validate ok + publish──► PUBLISHED ──newer version published──► ARCHIVED
```

- A flow has at most one DRAFT version (`draft_version_id`) and one active PUBLISHED version (`active_version_id`).
- **A published version is never edited.** "Edit" copies the active graph into a new DRAFT version.
- Publishing: validate → mark the draft PUBLISHED → set `active_version_id` → mark the previous published version ARCHIVED → emit an audit entry. New triggers use the new version.
- **Executions pin `flow_version_id`.** Running and waiting executions continue on the version they started with, even after it is archived.
- Pause: no new executions start. Waiting executions stay WAITING and resume only when the flow resumes (their delayed jobs check the flow status and re-delay by 1 minute while it is paused). Cancelling an execution sets it CANCELLED.

### Graph format (`packages/contracts/src/automation/graph.ts`)

```ts
type FlowGraph = {
  nodes: Array<{ id: string; type: NodeType; position: { x: number; y: number }; config: NodeConfig }>
  edges: Array<{ id: string; source: string; target: string; sourceHandle?: 'yes' | 'no' | 'next' | 'error' }>
}
```

- Node IDs are client-generated nanoids, stable across versions when copied.
- React Flow's own state is converted to and from this format at the UI boundary. The server never stores React Flow internals.

### Node catalog v1

| Category | Type | Config (Zod) | Outputs |
| --- | --- | --- | --- |
| Trigger | `trigger.message_received` | `{ phoneNumberIds?: string[]; onlyNewConversation?: boolean }` | next |
| Trigger | `trigger.keyword` | `{ keywords: string[] (1–20); match: 'EXACT' \| 'CONTAINS' \| 'STARTS_WITH'; caseSensitive: false }` | next |
| Trigger | `trigger.contact_created` | `{ sources?: ContactSource[] }` | next |
| Trigger | `trigger.webhook` | `{ contactPhonePath: string (JSONPath into body); requireSignature: boolean }` | next |
| Condition | `condition.equals` / `condition.contains` / `condition.exists` | `{ subject: Expr; value?: string; caseSensitive?: boolean }` | yes, no |
| Condition | `condition.has_tag` | `{ tagIds: string[]; match: 'ANY' \| 'ALL' }` | yes, no |
| Condition | `condition.contact_property` | `{ key: string; operator: DSL operator; value?: unknown }` | yes, no |
| Action | `action.send_message` | `{ text: string (≤ 4096, supports {{expr}}) } \| { mediaFileId; caption? }` | next, error |
| Action | `action.send_template` | `{ templateId: string; variables: VariableMapping }` (the approved version is resolved at run time) | next, error |
| Action | `action.add_tag` / `action.remove_tag` | `{ tagIds: string[] }` | next |
| Action | `action.assign_agent` | `{ mode: 'USER' \| 'ROUND_ROBIN'; userId?: string }` | next |
| Action | `action.update_contact` | `{ updates: Array<{ field: 'name' \| 'email' \| 'language' \| `property.${string}`; value: Expr }> }` | next, error |
| Action | `action.webhook` | `{ method: 'POST' \| 'GET'; url: string; headers?: Record<string,string>; body?: string (template); timeoutMs ≤ 10000; saveResponseAs?: string }` | next, error |
| Action | `action.delay` | `{ amount: number; unit: 'MINUTES' \| 'HOURS' \| 'DAYS' }` (1 minute to 30 days) | next |
| Message | `action.ai_reply` | `{ instructions?: string (≤ 1000); mode: 'SINGLE' \| 'CONVERSATION' }` (AI Assistant, docs/AI_ASSISTANT.md) | replied, needs_human, error |
| Action | `action.end` | `{}` | none |

**Expressions (`Expr`)** are a restricted template syntax, not code: `{{contact.name}}`, `{{contact.phone}}`, `{{contact.property.<key>}}`, `{{trigger.message.text}}`, `{{trigger.webhook.<jsonpath>}}`, `{{vars.<name>}}` (from `saveResponseAs`). They are resolved by a pure function, with no eval. A missing value resolves to `""`.

### Validation (publish gate)

| Rule | Code |
| --- | --- |
| Exactly one trigger node, with no incoming edges | `FLOW_TRIGGER_COUNT` |
| Every node reachable from the trigger | `FLOW_UNREACHABLE_NODE` |
| Every node's config passes its Zod schema | `FLOW_NODE_CONFIG_INVALID` |
| Condition nodes have both `yes` and `no` edges | `FLOW_CONDITION_BRANCHES` |
| AI reply nodes have exactly one `replied`, `needs_human` and `error` edge (to a step or an End) | `FLOW_DANGLING_NODE` |
| AI reply needs AI Assistant enabled for the workspace and at least one ready knowledge source | `FLOW_AI_NOT_ENABLED`, `FLOW_AI_NO_KNOWLEDGE` |
| AI replies used up this month: a **warning** (`validation.warnings`), never blocks publishing | `FLOW_AI_QUOTA` |
| Non-`end` nodes have a `next` edge (`error` is optional, and defaults to failing the execution) | `FLOW_DANGLING_NODE` |
| Cycles are allowed only if they pass through a `delay` node | `FLOW_CYCLE_WITHOUT_DELAY` |
| `send_template` references a template with an APPROVED version | `FLOW_TEMPLATE_NOT_APPROVED` |
| Referenced tags, users and properties exist | `FLOW_REFERENCE_MISSING` |
| At most 100 nodes | `FLOW_TOO_LARGE` |

The API returns `{ valid, errors: [{ nodeId?, edgeId?, code, message }] }`, and the builder highlights the offending nodes.

### Triggering

- The `automation.trigger` processor subscribes to `message.inbound.received`, `contact.created` and `conversation.automation_state.changed` (which stops the conversation's executions, P10-D2). `contact.updated` stays unsubscribed until a trigger needs it. The inbound webhook trigger is handled synchronously by the API (below).
- It loads PUBLISHED versions of ACTIVE flows whose `trigger_type` matches (indexed), and evaluates each trigger config against the event.
- **Keyword vs message-received precedence:** if any `trigger.keyword` flow matches, `trigger.message_received` flows do **not** start for that message.
- **Priority and multiple matches (decisions AE2 and AE3).** All matching active flows may execute. They are ordered by `priority` ascending (default 100), then `created_at` ascending, then `id` ascending. For example, priority 10 → Flow A, 20 → Flow B, 30 → Flow C.
  - For each triggering event, an `automation_trigger_runs` row stores that ordered plan. Flows for the same event run **one at a time, never concurrently**: the next flow starts only when the previous flow's execution reaches a terminal state (COMPLETED, FAILED or CANCELLED). Concurrent execution needs a future ADR.
  - A flow is **SKIPPED** (with a reason) when its re-entry policy forbids starting, or it is no longer ACTIVE when its turn comes.
  - Processing **stops** when an explicit condition requires it: the conversation enters `AGENT_TAKEOVER` or `AUTOMATION_PAUSED`, or (in the future) an exclusive/stop-processing flow completes. The remaining flows become STOPPED, and the run records `stop_reason`.
  - Execution history shows, per event: the matched flows, their order, and which ran, were skipped or stopped, and why.
  - The keyword vs message-received precedence rule above still decides which flows match.
- **Takeover gate:** message-based triggers don't start while the conversation is in `AGENT_TAKEOVER` or `AUTOMATION_PAUSED`.
- **Re-entry policy** (per flow): `ALWAYS`; `ONCE_PER_CONTACT` (never again after any execution for the contact); or `AFTER_COMPLETION` (default: not while an execution is RUNNING/WAITING for the same flow and conversation, which the DB partial unique index enforces).
- Webhook trigger: `POST /webhooks/automation/:token`. The token hash resolves the tenant and flow (`system.resolve_flow_webhook`). The contact is found or created by the phone at `contactPhonePath`. If `requireSignature`, the `X-Fenwira-Signature` HMAC is checked with the flow's secret. Returns 202 with `executionId`.

### Decisions P10-D1–D4 (2026-09-26, ADR-0025)

- **Execution states:** RUNNING, WAITING, COMPLETED, FAILED, CANCELLED, STOPPED_TAKEOVER. Trigger-run entries: PENDING, STARTED, COMPLETED, FAILED, CANCELLED, STOPPED_TAKEOVER, SKIPPED_TAKEOVER, SKIPPED (re-entry or inactive, with reason), SKIPPED_ENTITLEMENT.
- **Insufficient funds (P10-D1):** error code `INSUFFICIENT_FUNDS`; error branch or FAILED; never retried or waited on.
- **Takeover (P10-D2):** supersedes "ends as COMPLETED" below. The execution becomes STOPPED_TAKEOVER, the event's remaining flows SKIPPED_TAKEOVER, and nothing resumes.
- **Entitlements (P10-D3):** one boundary; no plan names in code; allow-all until Phase 11.
- **Outbound webhooks (P10-D4):** see `SECURITY.md` → Outbound webhooks.

### Execution semantics

- **Durable waiting (decision AE1).** There is no Wait-for-Reply node in the initial release. The execution model already supports durable waits: an execution in `WAITING` with `wait_until` is resumed by a job, as `delay` uses it. A future wait-for-reply node can add a resume-on-event path without changing how steps or versions work.

- `automation.execute` job data: `{ tenantId, executionId }`, with `jobId = jobId('exec', executionId, step_count)`.
- The processor loop, in which each step is its own transaction:
  1. Load the execution. If it is not RUNNING, or (on resume from delay) not WAITING with `wait_until ≤ now`, exit.
  2. Resolve the current node from the **pinned version's** graph.
  3. Insert an `automation_execution_steps` row (`seq = step_count + 1`, status RUNNING-equivalent via `started_at`) together with the node's side effects, **in the same transaction** where the effect is a DB write (tags, contact update, assignment).
  4. External effects:
     - **Sends** go through `MessagingService.send` with `idempotencyKey = auto:{executionId}:{seq}`. That call is itself transactional (it writes a message plus an outbox row), so a retry of the step returns the same message.
     - **Webhooks** are called outside the transaction. The step row is committed first with `status = WAITING` plus the request, then updated with the response. A retry repeats the HTTP call; outbound webhooks are documented as at-least-once.
  5. Choose the next node from the edge matching the result (`yes`/`no`/`next`/`error`). Update `current_node_id` and `step_count`.
  6. `delay`: set status WAITING and `wait_until`, and enqueue a delayed job. Otherwise continue the loop in the same job, up to 25 steps per job, then re-enqueue to yield.
- **Takeover during an execution (P10-D2):** before each step, `automation_state` is re-checked; if it is not ACTIVE (or a send is refused with `AUTOMATION_BLOCKED_BY_TAKEOVER`), the step is recorded SKIPPED and the execution ends **STOPPED_TAKEOVER**. The remaining flows of the trigger run become SKIPPED_TAKEOVER. `conversation.automation_state.changed` also stops RUNNING/WAITING executions of that conversation immediately. Nothing resumes when takeover ends.
- **Errors:** a failed node follows its `error` edge if one exists. Otherwise the execution becomes FAILED with the error code. Retryable infrastructure errors (DB or Redis) are retried by BullMQ (3 attempts). Business errors aren't retried.
- **Loop guard:** at most 500 steps per execution. Beyond that the execution is FAILED (`FLOW_STEP_LIMIT`).

### Determinism

The same pinned version, trigger event and DB state always produce the same path. That is guaranteed because:

- conditions are pure functions of the context and DB reads made within the step transaction
- there is no randomness (`ROUND_ROBIN` assignment is deterministic given DB state, and is documented as state-dependent)
- time comes only from `delay` (and is recorded)
- expression evaluation is pure

Test: replay a recorded trigger against a fixture DB twice and assert identical step sequences.

### Execution history UI

- The executions list per flow shows status, contact, started time, duration and version.
- Execution detail is a step timeline: ✓ (SUCCEEDED), ✗ (FAILED), ⏸ (WAITING) and ⤼ (SKIPPED), with node title, input and output (secrets and PII redacted in the UI unless the viewer has `automations.write`), and errors.
- "Show on canvas" opens the pinned version read-only and highlights the traversed path. Traversed edges are `primary`; the rest are `slate-400`.

### Builder colors

Experience V2 uses white node surfaces with category identity in semantic icon containers: trigger neutral/slate, message primary, condition warning, action info (timed waits warning). Selected nodes use primary-strong borders/rings. Idle edges remain slate-400; replay edges use primary, with textual step statuses. See `docs/design/EXPERIENCE_V2_AUTOMATIONS_RECONSTRUCTION.md`. These are presentation changes; the node catalog and runtime remain unchanged.

## Implementation (Phase 10)

Module `apps/api/src/modules/automation` (API and worker sides, like campaigns); contracts in `packages/contracts/src/automation/` (`graph.ts`, `validate.ts`, `expressions.ts`) and `api/automation.ts`.

| Piece | Where |
| --- | --- |
| Shared primitives: plan ordering, trigger runs, `startNextFlow`, `finishExecution`, takeover stop, job ids | `automation.core.ts` |
| In-transaction node handlers (conditions, tags, update contact, assign to a user, delay, end) | `engine.ts` |
| Trigger matching and takeover events | `automation-trigger.processor.ts` (`automation.trigger`) |
| Step interpreter, external actions, recovery | `automation-execute.processor.ts` (`automation.execute`) |
| Server publish gate (shared validator + reference checks) | `references.ts` |
| API, inbound webhook | `flows.service.ts`, `flows.controller.ts` |
| Entitlement boundary (P10-D3) | `modules/entitlements` (`EntitlementsService`, allow-all source) |
| SSRF-safe HTTP (P10-D4) | `core/http/safe-fetch.ts` |
| Builder | `apps/web/components/automation/*`, `apps/web/lib/automation.ts`, `/automations`, `/automations/new`, `/automations/[id]`, `/automations/[id]/history` |

**A step, precisely.** Phase 1 runs in one transaction holding the execution row lock (`FOR UPDATE`): wake a due WAITING execution (or re-delay it by 1 minute while the flow is PAUSED), apply the 500-step limit, check takeover, load the context, and either run an internal node and record its step in the same transaction, or render what an external node will do. Phase 2 (external nodes only, no transaction): `MessagingService.send` with `auto:{executionId}:{seq}`, the round-robin assignment, or `safeFetch`. Phase 3 re-takes the lock and records the step only if the execution is still RUNNING at the same step and node; otherwise the result is dropped (`superseded`), which is how duplicate workers and a concurrent takeover or cancel resolve. Webhook calls therefore happen at least once, with `Idempotency-Key: auto:{executionId}:{seq}`.

**Trigger runs.** `unique (tenant_id, event_id)` makes a redelivered outbox event a no-op, and `unique (trigger_run_id, flow_id)` allows one execution per flow per event. The run's plan is advanced in the same transaction as each terminal state; a conversation that has left `AUTOMATION_ACTIVE` when the next flow's turn comes stops the run (remaining flows SKIPPED_TAKEOVER). The trigger node is the first recorded step.

**Delays and recovery.** A delay commits WAITING, `wait_until` and the next node, then enqueues a delayed job `exec__{id}__{seq}`. Every 60 s, recovery (X16) re-enqueues WAITING executions past `wait_until` and RUNNING ones untouched for 2 minutes, with a per-minute suffix on the job id so a retained completed job never swallows it. The row lock and state checks make duplicate jobs harmless.

**Webhook trigger.** The API resolves the token hash (X8), verifies `X-Fenwira-Signature` with the flow's decrypted secret (when the trigger requires it), finds or creates the contact from `contactPhonePath` (source `API`, emitting `contact.created`), and creates the trigger run and execution in the same request so it can return the execution id (202). An `Idempotency-Key` header maps to a deterministic event id. Webhook runs have no conversation, so sends go to the contact through the default (or the template's WABA) number, and MessagingService's service-window rule applies as usual.

**Refusals.** MessagingService refusals become FAILED steps with the refusal code (`CONVERSATION_WINDOW_CLOSED`, `CONSENT_REQUIRED`, `TEMPLATE_NOT_APPROVED`, …) and follow the error edge; `INSUFFICIENT_BALANCE` is recorded as `INSUFFICIENT_FUNDS` (P10-D1); `AUTOMATION_BLOCKED_BY_TAKEOVER` ends the execution STOPPED_TAKEOVER. Non-business errors are retried by BullMQ (3 attempts); the idempotency key prevents a duplicate send.

**Builder.** React Flow (`@xyflow/react` 12.11.6) and dagre (`@dagrejs/dagre` 3.1.1), pinned. The canvas and the keyboard Outline edit the same `DraftGraph`; drafts autosave (800 ms) with `If-Match`, and the shared validator runs on every change, with server reference problems from the last save added. Drafts may hold incomplete settings; the strict schema applies at publish and at run time. The builder's send-message form handles text; media sends are supported by the API and runtime (`mediaFileId`) but not yet by the builder form.

### AI reply step (AI Assistant, ADR-0028)

- **Phases.** Phase 1 (`prepareAi`, in the step transaction) picks the customer message to answer and checks the 24-hour window. Outside the window the step fails with `CONVERSATION_WINDOW_CLOSED` and takes its error path: free text isn't allowed, and the model isn't called. Phase 1 also loads the last `AI_HISTORY_MESSAGES` messages. Phase 2 (`externalAi`) runs the answer pipeline and the step decision, then sends. Phase 3 records the step as usual.
- **Retry safety.** The answer and the step's decision (outcome plus the exact text to send) are saved in `ai_reply_logs` under the unique `(run_id = execution id, step_id = seq)` **before** anything is sent. A retried or duplicated step reads that row back, so there is never a second model call, and the send reuses `auto:{executionId}:{seq}`, so there is never a second message. AI messages carry `messages.ai_generated = true` (the inbox's "AI" label).
- **Conversation mode.** After a reply the step stays on the same node: the execution goes WAITING with `wait_until = now + 24 h` and `context.ai = {mode, lastHandledMessageId, pendingMessageId}`. Each inbound message for that conversation sets `pendingMessageId` and resumes the same execution (job `exec__{id}__{stage}__m{messageId}`) instead of starting new flows. A message arriving while an answer is in flight is answered right after it. The run ends:
  - on `needs_human` (handoff);
  - on human takeover (P10-D2, STOPPED_TAKEOVER);
  - on resolve (`conversation.resolved` → COMPLETED, last step `{ended: CONVERSATION_RESOLVED}`);
  - when a keyword flow matches the new message (COMPLETED `{ended: KEYWORD_FLOW}`; the keyword flows then run as usual);
  - after 24 hours of silence (the wait expires → `replied` path, `{ended: SILENCE}`).

  Re-entry rules apply unchanged: the managed flow uses AFTER_COMPLETION.
- **Handoff.** `needs_human` moves the conversation to AGENT_TAKEOVER with the system event `ai_handoff` and the usual `conversation.automation_state.changed` event. That event stops every other execution of the conversation; the handing-off execution is marked `context.aiHandoff` and finishes its own Needs a human path.
- The 500-step cap, the per-step takeover check and BullMQ retries apply as for every node. The trigger and conversation history are never stored in step input/output (only `mode`, `messageId`, `outcome`, `replyLogId`, `messageId` of the reply).

## Open questions

None. Resolved in the specification freeze (2026-09-26); see `PRODUCT.md` → Decision register.


### Experience V2 studio

The shared BuilderPage studio appearance joins the searchable node library, warm canvas and selected-step settings. Below 1280px settings use a focus-trapped modal; below 768px the Outline is the initial view. The catalog, expressions, graph adapter, validation, optimistic If-Match autosave, published versions, history and replay are reused. An explicit Save flushes that same autosave path, and Publish confirms version impact. Message/template previews preserve unresolved expressions and use authorized template samples. Header counts are the existing all-time total/running values, not invented daily metrics. Draft-read errors now expose retry instead of an indefinite skeleton. No wait-for-reply/customer-replied node or test simulator is added. [Visual checkpoint](design/EXPERIENCE_V2_AUTOMATIONS_RECONSTRUCTION.md).

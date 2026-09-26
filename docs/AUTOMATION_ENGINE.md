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
| Action | `action.end` | `{}` | none |

**Expressions (`Expr`)** are a restricted template syntax, not code: `{{contact.name}}`, `{{contact.phone}}`, `{{contact.property.<key>}}`, `{{trigger.message.text}}`, `{{trigger.webhook.<jsonpath>}}`, `{{vars.<name>}}` (from `saveResponseAs`). They are resolved by a pure function, with no eval. A missing value resolves to `""`.

### Validation (publish gate)

| Rule | Code |
| --- | --- |
| Exactly one trigger node, with no incoming edges | `FLOW_TRIGGER_COUNT` |
| Every node reachable from the trigger | `FLOW_UNREACHABLE_NODE` |
| Every node's config passes its Zod schema | `FLOW_NODE_CONFIG_INVALID` |
| Condition nodes have both `yes` and `no` edges | `FLOW_CONDITION_BRANCHES` |
| Non-`end` nodes have a `next` edge (`error` is optional, and defaults to failing the execution) | `FLOW_DANGLING_NODE` |
| Cycles are allowed only if they pass through a `delay` node | `FLOW_CYCLE_WITHOUT_DELAY` |
| `send_template` references a template with an APPROVED version | `FLOW_TEMPLATE_NOT_APPROVED` |
| Referenced tags, users and properties exist | `FLOW_REFERENCE_MISSING` |
| At most 100 nodes | `FLOW_TOO_LARGE` |

The API returns `{ valid, errors: [{ nodeId?, edgeId?, code, message }] }`, and the builder highlights the offending nodes.

### Triggering

- The `automation.trigger` processor subscribes to `message.inbound.received`, `contact.created`, `contact.updated` (reserved for later triggers) and `conversation.automation_state.changed` (ignored in v1).
- It loads PUBLISHED versions of ACTIVE flows whose `trigger_type` matches (indexed), and evaluates each trigger config against the event.
- **Keyword vs message-received precedence:** if any `trigger.keyword` flow matches, `trigger.message_received` flows do **not** start for that message.
- **Priority (decision AE2).** Each flow has an integer `priority` (default 100; lower runs first). Matching flows are ordered by `priority`, then `created_at`, then `id`, so the order is always deterministic. Only the first flow in that order starts. Whether all matching flows should run in order instead is open question AE3.
- **Takeover gate:** message-based triggers don't start while the conversation is in `AGENT_TAKEOVER` or `AUTOMATION_PAUSED`.
- **Re-entry policy** (per flow): `ALWAYS`; `ONCE_PER_CONTACT` (never again after any execution for the contact); or `AFTER_COMPLETION` (default: not while an execution is RUNNING/WAITING for the same flow and conversation, which the DB partial unique index enforces).
- Webhook trigger: `POST /webhooks/automation/:token`. The token hash resolves the tenant and flow (`system.resolve_flow_webhook`). The contact is found or created by the phone at `contactPhonePath`. If `requireSignature`, the `X-Fenwira-Signature` HMAC is checked with the flow's secret. Returns 202 with `executionId`.

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
- **Takeover during an execution:** before each send step, re-check `automation_state`. If it is not ACTIVE, the step is recorded as `SKIPPED` with `AUTOMATION_BLOCKED_BY_TAKEOVER`, and the execution ends as COMPLETED with `error_code = AUTOMATION_BLOCKED_BY_TAKEOVER`. (An execution never waits for takeover to end.)
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

Trigger `slate`, message `surface`, condition `warning`, action `info`. The selected node gets a `primary` ring. Idle edges are `slate-400` and active or highlighted edges are `primary` (from `DESIGN_SYSTEM.md`).

## Open questions

| # | Question | Owner |
| --- | --- | --- |
| AE3 | When several flows match one event, does only the highest-priority flow start, or do all matching flows run in priority order? | Product |

AE1 and AE2: Resolved in the specification freeze (2026-09-26); see `PRODUCT.md` → Decision register.

# Phase 10 — Automation & Visual Flow Builder

**Goal:** published workflows execute deterministically and can be inspected, paused and versioned.

**Read:** `AGENTS.md`, `docs/AUTOMATION_ENGINE.md`, `docs/INBOX.md` (takeover), `docs/DESIGN_SYSTEM.md` (node and edge colors).

## Build

1. **Entities:** `Flow` (name, status, active_version_id), `FlowVersion` (immutable graph JSON: nodes plus edges with branch labels, version number, state ∈ DRAFT/PUBLISHED/ARCHIVED, published_by, published_at), `AutomationExecution` (flow version, contact, conversation, trigger event, status ∈ RUNNING/WAITING/COMPLETED/FAILED/CANCELLED, current node) and `AutomationExecutionStep` (node, input, output, status, error, started/finished).
2. **Node catalog v1** (config schemas in `packages/contracts`):
   - Triggers: Message Received, Keyword, Contact Created, Webhook (inbound signed URL per flow).
   - When several flows match, all may execute, one after another in deterministic order: `priority` ascending, then created time, then ID (decisions AE2 and AE3), never concurrently for the same event. Takeover (or a future exclusive flow) stops the remaining flows. `automation_trigger_runs` records the matched flows, their order, and the skipped and stopped flows with reasons. There is no Wait-for-Reply node (AE1), but the WAITING/resume model must allow one later.
   - Conditions: Equals, Contains, Exists, Has Tag, Contact Property, with YES/NO branches.
   - Actions: Send Message, Send Template, Add Tag, Remove Tag, Assign Agent, Update Contact, Webhook (outbound HTTP with timeout, retry and response mapping), Delay, End.
3. **Lifecycle:** DRAFT → VALIDATE (one trigger, every node reachable, no cycles without a Delay, every required config set, every template approved) → PUBLISH (creates an immutable version) → ACTIVE. A running version is never edited; editing creates a new draft. Executions stay pinned to the version they started on.
4. **Engine (`automation.execute` worker):**
   - Triggered by domain events from the outbox.
   - A deterministic, step-by-step interpreter that persists every step before moving to the next.
   - Delay is a BullMQ delayed job.
   - Sends go through `MessagingService` with `source: 'automation'`, and are rejected during AGENT_TAKEOVER or AUTOMATION_PAUSED, in which case the execution waits or ends per config.
   - One active execution per (flow, conversation). Configurable re-entry.
   - Loop guard: at most N steps per execution.
5. **Builder UI (React Flow):**
   - A node palette, drag to canvas, a config side panel with schema-driven forms, inline validation errors on nodes, auto-layout, and zoom/minimap.
   - Colors: trigger `slate`, message `surface`, condition `warning`, action `info`, selected `primary` ring, idle edges `slate-400`, active or highlighted edges `primary`.
6. **Flows list and execution history:** status, version and run counts. A per-execution timeline shows ✓/✗ per step with input/output, and a replay overlay highlights the path taken on the canvas. Pause or resume a flow; cancel an execution.

## Acceptance criteria

- [ ] The same trigger and the same data always produce the same step sequence (determinism test).
- [ ] Three matching flows (priorities 10, 20, 30) run in that order, one at a time; a takeover during the first stops the other two, and the history shows the order, the stopped flows and the reason.
- [ ] Publishing v2 while v1 executions are mid-Delay: those finish on v1, and new triggers use v2.
- [ ] An agent reply mid-flow sets takeover, and the next automation send is rejected and recorded as such.
- [ ] A worker crash during a Delay: the execution resumes after restart with no duplicated step.
- [ ] Validation blocks publishing an invalid graph and pinpoints the offending nodes.

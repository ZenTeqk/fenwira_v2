# ADR-0025: Automation funds, takeover, entitlements and outbound webhook security

**Status:** Accepted (2026-09-26). Decisions P10-D1–D4; the plan is in `docs/plans/PHASE_10_PLAN.md`.

## Decision

1. **Insufficient funds (P10-D1):** a billable automation send that can't reserve funds records `INSUFFICIENT_FUNDS`, follows the node's error branch if present, otherwise fails the execution. Never auto-retried; no implicit wait.
2. **Takeover terminates (P10-D2):** the execution becomes `STOPPED_TAKEOVER`, no further actions run, the remaining flows of the triggering event are `SKIPPED_TAKEOVER`, and nothing resumes after takeover ends.
3. **Entitlement boundary (P10-D3):** automation capability checks (`automation_enabled`, `max_active_flows`, `automation_execution_limit`) go through one `EntitlementsService` with a pluggable source. Phase 10 ships allow-all; Phase 11 supplies plan data. No plan names appear in code.
4. **Outbound webhooks (P10-D4):** production requires HTTPS. The SSRF guard validates every resolved address and every redirect hop, pins the connection to the validated address, and enforces timeouts, a size cap, a redirect limit and safe methods. Secrets are redacted. A development allow-list of hosts exists only outside production.

## Consequences

- Execution history has distinct terminal states for failure, cancellation and takeover.
- The engine never blocks on external conditions it can't observe deterministically (funds, takeover ending).
- A new direct runtime dependency on `undici` (connection pinning).

## Alternatives rejected

- Waiting for funds or for takeover to end: an unbounded wait, and surprising sends long after the triggering context.
- Checking plan names in automation code: couples the engine to commercial packaging.
- Validating only the first URL: redirects and DNS rebinding bypass it.

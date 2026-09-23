# Phase 12 — Production Hardening

**Goal:** Fenwira meets a documented production-readiness checklist (`docs/PRODUCTION_READINESS.md`, created in this phase), with evidence for every item.

**Read:** `AGENTS.md`, `docs/SECURITY.md`, `docs/OBSERVABILITY.md`, `docs/DEPLOYMENT.md`.

## Security

- RLS penetration suite: attempt cross-tenant access through every endpoint, WebSocket, export, search and background job path.
- RBAC matrix re-verified against every endpoint (generated).
- Session security: cookie flags, refresh reuse, fixation, logout everywhere.
- Rate-limit tests on auth, webhooks and public API.
- Webhook spoofing: bad signature, replay, oversized body.
- CSRF, XSS (message content, contact fields, template preview), SQL injection (filter DSL, search).
- File uploads: type sniffing, size limits, image re-encoding, no executable content.
- Secret scanning (gitleaks) and dependency scanning (audit + Trivy) are both blocking in CI.
- PII logging review: grep captured logs from a full E2E run for phone numbers, emails, tokens and message bodies.

## Performance (k6 + scripted load, results in `docs/perf/`)

API concurrency, WebSocket concurrency (for example 1k sockets), webhook bursts (for example 500/s), campaign bursts, Redis queue depth, DB connection saturation (add PgBouncer if needed), worker crash under load, and Meta API errors (injected 429/5xx). Record p50/p95/p99 and the limits found.

## Failure testing

Intentionally kill Redis, the worker, the API, Postgres connections and the network, and inject Meta request failures. For each one, document the expected behavior, the observed behavior and the recovery time. Nothing is lost or duplicated.

## Backup and restore

Automate `pg_dump` plus MinIO bucket backup on a schedule with retention. **Restore to a fresh stack, then verify** row counts and a smoke E2E. Document the RPO/RTO achieved. A backup that has never been restored isn't a verified backup.

## Observability

OpenTelemetry traces across web → api → queue → worker → Meta. Metrics are exported in Prometheus format. Add `fenwira-otel`, `fenwira-prometheus` and `fenwira-grafana` to compose (under a profile), with dashboards and alerts for:

- webhook failures
- queue backlog
- high failed-message %
- worker crash
- DB connection exhaustion
- Redis memory
- API 5xx
- high p95 latency

## Acceptance criteria

- [ ] `docs/PRODUCTION_READINESS.md` has every item checked, each linking to its evidence (test run, report, dashboard screenshot).
- [ ] Zero open high or critical findings from security testing.
- [ ] A restore drill has been completed within the last 7 days.
- [ ] Every alert has been fired at least once in a drill and routed correctly.

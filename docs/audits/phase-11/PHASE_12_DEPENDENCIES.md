# Phase 12 dependencies after Phase 11 remediation

Reconciled 2026-10-20. No Phase 12 implementation performed. Phase 11 application fixes and local acceptance are complete; formal closure is pending X-10/X-12. See [current audit](PHASE_11_AUDIT_REPORT.md).

| Dependency | Current status | Required evidence / ownership |
|---|---|---|
| F01 wallet state/idempotency | Locally resolved, `d638a41` | Eight actual PG regression cases; before enforcement, authorized deployed drift assessment and append-only correction if required |
| F02 durable webhook recovery | Locally resolved, `0b2d48f` | Nineteen cases including deleted Redis jobs/crash/timeout; staging worker/schedule observation still required |
| F03 subscription fairness | Locally resolved, `a82cf6f` | Real 501-workspace lifecycle coverage; staging scheduler progress still required |
| F04/F05 analytics invalidation/fairness | Locally resolved, `d4541bd` | Quiet ledger credit and >500 traversal plus source reconciliation; fleet performance separately measured |
| V1/V2 integration/browser/build | Locally verified | Current totals in TEST_RESULTS; Linux default build and release assembly pass; remote CI is separate |
| V4 current CI/clean Compose/deployed prerequisites | OPEN; Phase 11 closure gate | Authorized publication, CI and clean Compose boot/smoke; staging worker/outbox/schedulers/SMTP/flags observation |
| V3 performance, dashboards and alert routing | Phase 12 verification, nonblocking Phase 11 local acceptance | Load baselines and query plans, end-to-end external alert routing, failure/backups/restoration drills under approved Phase 12 plan |

Financial/provider-cost confidentiality, tenant isolation, immutable receipts/audits, default-off flags and existing module/queue boundaries carry forward. Do not reintroduce first-page-only selection or infer durable work from Redis alone. Webhooks retain at-least-once delivery with stable identifiers.

Production prices, price book/markup, GST/invoicing, promotional consumption/expiry, payment provider, POSTPAID and broader developer/API ecosystem need separate product/accounting approval. They are not quietly added to Phase 12 or treated as Phase 11 defects. Do not enable charging against placeholder values.

Phase 12 planning may proceed independently; actual implementation was not requested here. Formal Phase 11 closure, production rollout and enforcement remain distinct decisions. No live data repair, provisioning or deployment is authorized by this document.

# Phase 11 Step 5 acceptance preparation

Step 4 ACCEPTED; Step 5 implementation in nine increments. Phase 11 remains OPEN. Implementation and local checks are complete and ready for acceptance review. Concrete evidence is recorded in [STEP5_VALIDATION.md](STEP5_VALIDATION.md): 291 unit tests, 470 integration tests, 70 browser tests, healthy built images and smoke checks, and five Lighthouse accessibility scores of 100. Existing optional skips are documented. CI, clean-clone deployment and production rollout are not claimed.

## Reviewable behavior

- Global PLATFORM_OPERATOR grant, restricted grant/revoke CLI, mandatory password/TOTP, revocable 30-minute privilege with 10-minute idle and five-minute fresh-MFA writes.
- No tenant membership/API-key authority, no RLS bypass, no unrelated conversation content.
- Narrow workspace discovery/commercial read, configured vs enforced entitlements, internal recorded cost coverage.
- Append-only paid/promotional credits, available-funds-safe corrections and capped usage refunds; immutable atomic receipts/audits/outbox and identical retry replay.
- Shared activation/mode/override services and CLI adapters; existing subscription lifecycle and override precedence.
- Separate /platform UI, previews/confirmations, consequential actions, audit/receipt details and accessible states.
- Metrics, failed-operation audit/redaction, broad-access warnings and wallet reconciliation integration.

## Focused Step 4 corrections

Reproduced negotiated retention being overwritten on activation, and successive downgrades shortening original automatic grace. Explicit support override value/reason/expiry is preserved; automatic grace preserves the largest prior window and renews 30 days. Focused integration regressions verify both; no plan-name authorization, trial, enforcement rollout, pricing or tax decisions changed.

## Commercial constraints

Founder approval: negative corrections cannot make available funds negative after reservations; full/partial message-usage refunds cumulatively capped at original debit. No cash refunds/unused-paid-credit withdrawal or promotional clawback. Production prices, promotional consumption/expiry policy, GST/invoices, gateways and postpaid remain unresolved and unimplemented. Support contact configuration remains unchanged.

## Deployment / backfill

Additive migrations create grants, challenges/sessions, immutable platform audit and tenant commercial receipts, then bind challenges to backing families. Legacy unbound challenges expire; no financial/subscription/analytics history is rewritten. Existing tenants need no backfill or operator memberships. Provision only verified enrolled global identities using restricted infrastructure credentials. Runbook: ../runbooks/PLATFORM_OPERATIONS.md.

## After acceptance — separate Phase 11 closure

1. Review Steps 1–5 evidence and frozen decisions, migrations/RLS, rollout safeguards and operator recovery.
2. Approve a separate controlled closure checkpoint covering workspace creation → trial → entitlements → subscription → funding → messaging/campaign/automation usage → analytics → API/webhook entitlement → trial expiry → activation → downgrade/upgrade → financial support → audit/reconciliation.
3. Confirm production commercial decisions/rollout remain separately gated; test-only enforcement is not production rollout approval.
4. Execute that checkpoint only when authorized; retain concrete evidence and resolve failures before declaring Phase 11 CLOSED.

This task does not execute the closure checkpoint or change BILLING_SUBSCRIPTIONS_ENFORCED for real users.

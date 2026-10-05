# Step 5 validation

Status: in progress; neither Step 5 acceptance nor Phase 11 closure claimed.

## Increment 1 — operator identity

- `pnpm lint`: passed (including dependencies/design tokens).
- `pnpm typecheck`: passed.
- `pnpm test`: passed with local-socket permission; sandbox run had mock socket failures.
- Cached Docker test image, updated source, migration + database integration: 247/247 passed, including platform grant denial/revocation and immutable hidden audit.
- Standard Docker build encountered registry frontend timeout; cached image fallback retains Linux dependencies and tests actual updated sources.
- RLS discovery passed. No rollout flag changed.

## Increment 2 — privileged authentication

- Lint and full typecheck passed.
- Real API/PostgreSQL/Redis platform suite: 5/5 passed (OWNER/API-key denial, mandatory MFA, no membership, concurrent replay, CSRF/logout, grant/idle/absolute/parent revocation).
- Dedicated cookies and MFA age never alter tenant session lifetimes or rollout flags.
- API unit suite: 125/125 passed after regenerating OpenAPI with distinct platform-session security.

## Increment 3 — receipts/audit/idempotency

- Lint/typecheck passed for receipt infrastructure.
- Database integration 251/251; new receipt included in forced-RLS/append-only matrix.
- Platform integration 6/6; ten identical concurrent credit operations yield one receipt/ledger row, changed payload conflicts, injected failure rolls back financial mutation.
- Platform security unit tests 3/3: recursive secret/content redaction, separate route catalog, exact-money deterministic fingerprints.

## Increment 4 — commercial reads

- Full lint/typecheck passed; OpenAPI/security catalog unit tests 8/8.
- Platform integration 7/7: commercial search/detail works without membership; unknown cost is excluded from contribution; configured/enforced state separated; conflicting workspace header denied; customer content APIs remain inaccessible.
- No historic provider cost or placeholder provenance fabricated. Current tax metadata is not a tax calculation.

## Increment 5 — funding/corrections/refunds

- Full lint/typecheck passed; generated OpenAPI/security catalog 8/8 and exact-decimal CLI unit test 1/1 passed.
- Platform integration 8/8 passed: concurrent identical HTTP credits, changed-key payload conflicts, promotional expiry metadata, partial/refund cap, cross-workspace debit denial, reservation-safe negative adjustments, fresh-MFA enforcement and failure audit.
- Founder-approved scope recorded: no negative available funds; usage refunds only, cumulative cap at original debit.
- CLI funding uses the same MFA-authenticated HTTP/domain service. Outbox and deduplicated billing-reader notifications share receipt IDs.

## Increment 6 — subscription/mode/override services

- Full lint/typecheck passed; OpenAPI regenerated.
- Real platform integration 10/10 passed, including replay without new subscription period, typed/unlimited overrides, removal, PREPAID mode, rejection of POSTPAID and period-end cancellation. One outbox event per receipt.
- Step 4 regression reproduced before fix (500-day negotiated override became 365); passes after preserving active override. Explanation in BILLING.md.
- Reviewed state remains valid for initially unfunded workspaces: wallet creation happens inside mutation, after version check.

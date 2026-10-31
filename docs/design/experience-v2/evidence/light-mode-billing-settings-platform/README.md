# Light mode: Billing, Settings and the operator console (2026-10-31)

`before/` is `main` at `1d406ef`; `after/` is this change. Both come from
`apps/web/e2e/light-mode-billing-settings-platform-review.spec.ts`:

```bash
REVIEW_SHOTS_DIR=$PWD/docs/design/experience-v2/evidence/light-mode-billing-settings-platform/after \
  pnpm --filter @fenwira/web exec playwright test e2e/light-mode-billing-settings-platform-review.spec.ts
```

`REVIEW_BEFORE=1` records page overflow (with the offending elements) in `page-overflow.txt`
instead of failing. `E2E_WEB_UPSTREAM=http://127.0.0.1:3001` reviews a build served on another
port while the page keeps the `localhost:3000` origin the local API expects.

- **Billing** uses a real local owner; every `/billing` response is a contract-shaped fixture and
  every billing write is refused and asserted absent. The UPI payee is fictional; the QR is made
  with the API's own `qrcode` settings.
- **Settings** uses the owner's real workspace; a long-named member and an invitation are added in
  the browser only, and the one save attempt gets a mocked validation error.
- **Platform** uses a local operator fixture (revoked afterwards). Cross-tenant lists are fixtures,
  so no other local tenant appears. Drawers and confirmations are opened, never submitted.

Mobile overflow on main (`before/page-overflow.txt`): `/platform/workspaces`, payments, billing
operations and workspace detail were 528 px too wide at 375 px (the old console nav). After the
new shell, workspace detail still overflowed by a long owner email in `SummaryItem`, which now
wraps (`wrap-anywhere`). `after/` has no page overflow at 375, 768 or 1024 px.

# Light mode: Analytics and Integrations (2026-10-31)

Extends the approved light theme after #109–#111. `before/` is `main` at `60bbc92` (built in an
isolated worktree); `after/` is this change. Both come from
`apps/web/e2e/light-mode-analytics-integrations-review.spec.ts` with the same configuration:

```bash
REVIEW_SHOTS_DIR=$PWD/docs/design/experience-v2/evidence/light-mode-analytics-integrations/after \
  pnpm --filter @fenwira/web exec playwright test e2e/light-mode-analytics-integrations-review.spec.ts
```

- **Analytics** reads the real API responses (genuine contract shapes) and fills them in the
  browser only with deterministic values whose totals agree with their parts (runs = sum of
  outcomes; usage table = chart). Not product data. The "not processed" capture is the real,
  unmodified response; the error capture is a mocked 503.
- **Integrations** uses records created through the domain APIs: the mock WhatsApp number, an API
  key and a webhook endpoint. The key's one-time secret is never read, logged or shown; the
  ERPNext dialog is opened empty and never submitted. No provider is authorized and nothing syncs.

`before/` stops at the chart table step: on `main` the "Show as table" scroll region isn't
keyboard-focusable (axe `scrollable-region-focusable`), fixed in this change.

| Files | Shows |
| --- | --- |
| `analytics-{overview,messaging,campaigns,inbox,automations,usage}-1440.png` | Every view (`*-dark.png` for overview, messaging, automations, usage) |
| `analytics-overview-{1024,768,375}.png`, `analytics-usage-375.png` | Narrow layouts |
| `analytics-date-range-open-1440.png`, `analytics-messaging-table-1440.png` | Date control, table alternative |
| `analytics-not-processed-1440.png`, `analytics-error-1440.png` | Not processed yet vs load failure |
| `integrations-{overview,whatsapp,api,webhooks,webhook-detail}-1440.png` (+ `-dark`) | Every page |
| `integrations-{overview,whatsapp,webhook-detail}-375.png` | Narrow layouts |
| `integrations-erpnext-dialog-1440.png` | Connector setup dialog |

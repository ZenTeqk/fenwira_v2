# Dark theme: application-wide verification (2026-10-31)

The completed light-mode implementation is the baseline. Every review runs with the document root
forced to `data-theme="dark"` (`REVIEW_THEME=dark`, `applyReviewTheme` in `apps/web/e2e/support.ts`:
set before any app script and kept if re-rendered). Portaled dialogs, menus and tooltips render
under `<html>` and inherit it (`overlay-*.png`). Each route also asserts the theme is really dark,
so a silent light run fails. There is no theme switcher.

All runs used a production build (`next build`, `next start` on :3001 with
`ENABLE_UI_GALLERY=true`) reached through the opt-in `E2E_WEB_UPSTREAM` relay; the developer's
`next dev` on :3000 was untouched.

```bash
export REVIEW_THEME=dark E2E_WEB_UPSTREAM=http://127.0.0.1:3001
REVIEW_SHOT_WIDTHS=1440,375 REVIEW_SHOTS_DIR=$PWD/docs/design/experience-v2/evidence/dark-mode-verification \
  pnpm --filter @fenwira/web exec playwright test e2e/light-mode-app-verification.spec.ts
LIGHT_SHOTS_DIR=$PWD/docs/design/experience-v2/evidence/dark-mode-verification/modules \
AUTOMATION_SHOTS_DIR=$PWD/docs/design/experience-v2/evidence/dark-mode-verification/modules \
  pnpm --filter @fenwira/web exec playwright test e2e/light-mode-review.spec.ts e2e/light-mode-automation-review.spec.ts
pnpm --filter @fenwira/web exec playwright test e2e/light-mode-modules-review.spec.ts \
  e2e/light-mode-analytics-integrations-review.spec.ts e2e/light-mode-billing-settings-platform-review.spec.ts
E2E_BASE_URL=http://127.0.0.1:3001 pnpm --filter @fenwira/web exec playwright test e2e/keyboard.spec.ts \
  e2e/a11y.spec.ts e2e/responsive.spec.ts -g "dev/ui|Dropdown|Modal|Tabs|ConfirmDialog|open overlays"
```

## Results (dark)

| Check | Result |
| --- | --- |
| App-wide sweep: every route family at 1440/768/375, document overflow + axe (1440, 375), overlays, focus, access denied, load error | 4/4; 56 entries, 0 failing cells |
| Module reviews with axe: Home and Inbox (bubbles, notes, failed send, closed window), Contacts, Templates, Campaigns, Automations and flow builder, Reply Studio, AI Assistant, Analytics (charts, tables), Integrations, Billing (UPI QR), Settings, `/platform` | 14/14 |
| Gallery: axe on the page and open overlays, keyboard (dropdown, modal, tabs, confirm), responsive 375/768/1024/1440 | 10/10 |
| Token contrast, both themes (`@fenwira/ui` tokens tests) | Pass (430 ui tests) |
| Light-mode spot-check on the same build: app-wide sweep and Home/Inbox review | 6/6 |

Inbox in dark (`modules/inbox-*.png`): neutral charcoal shell, dark chat canvas, forest-green
outgoing bubbles, dark-grey incoming bubbles, readable metadata, blue read ticks, amber internal
notes. Flow builder (`modules/builder-*.png`): dark canvas and nodes, violet start accent, visible
edges, `fg` selection outline, amber needs-attention, emerald Publish. Earlier `*-dark.png`
captures for Analytics, Integrations, Billing, Settings and `/platform` remain in
`light-mode-analytics-integrations/after/` and `light-mode-billing-settings-platform/after/`.

## Defects

No product defect was found in dark: no colour, contrast, overflow, focus or overlay failure, so no
token or component changed. Harness defects fixed while verifying:

- The dark init script ran before `<html>` existed, so a first sweep silently ran in light. It now
  applies as soon as the root appears, and the sweep asserts dark on every route.
- The automation review shares one page across tests, so per-test hooks never reached it (it ran
  in light against :3000). The helpers now apply to that context.
- The relay now also carries local object storage (:9000), which the contacts CSV import uploads to.
- The relay moved into `support.ts` (`applyWebUpstream`) and is shared by every review spec.

## Route matrix (dark)

| Family | Route | Lands on | 1440 | 768 | 375 |
| --- | --- | --- | --- | --- | --- |
| auth | `/login` | `/login` | ✓ | ✓ | ✓ |
| auth | `/register` | `/register` | ✓ | ✓ | ✓ |
| auth | `/forgot-password` | `/forgot-password` | ✓ | ✓ | ✓ |
| auth | `/reset-password?token=review-invalid-token` | `/reset-password` | ✓ | ✓ | ✓ |
| auth | `/invitations/review-invalid-token` | `/invitations/review-invalid-token` | ✓ | ✓ | ✓ |
| auth | `/platform/login` | `/platform/login` | ✓ | ✓ | ✓ |
| auth | `/this-route-does-not-exist` | `/login` | ✓ | ✓ | ✓ |
| auth | `/two-factor` | `/two-factor` | ✓ | ✓ | ✓ |
| auth | `/verify-email` | `/verify-email` | ✓ | ✓ | ✓ |
| onboarding | `/onboarding` | `/onboarding` | ✓ | ✓ | ✓ |
| home | `/dashboard` | `/dashboard` | ✓ | ✓ | ✓ |
| inbox | `/inbox` | `/inbox` | ✓ | ✓ | ✓ |
| contacts | `/contacts` | `/contacts` | ✓ | ✓ | ✓ |
| contacts | `/contacts/imports` | `/contacts/imports` | ✓ | ✓ | ✓ |
| contacts | `/contacts/segments` | `/contacts/segments` | ✓ | ✓ | ✓ |
| contacts | `/contacts/tags` | `/contacts/tags` | ✓ | ✓ | ✓ |
| templates | `/templates` | `/templates` | ✓ | ✓ | ✓ |
| templates | `/templates/new` | `/templates/new` | ✓ | ✓ | ✓ |
| campaigns | `/campaigns` | `/campaigns` | ✓ | ✓ | ✓ |
| campaigns | `/campaigns/new` | `/campaigns/new` | ✓ | ✓ | ✓ |
| campaigns | `/campaigns/analytics` | `/campaigns/analytics` | ✓ | ✓ | ✓ |
| automations | `/automations` | `/automations/workflows` | ✓ | ✓ | ✓ |
| automations | `/automations/workflows` | `/automations/workflows` | ✓ | ✓ | ✓ |
| automations | `/automations/new` | `/automations/new` | ✓ | ✓ | ✓ |
| automations | `/automations/reply-studio` | `/automations/reply-studio/auto-replies` | ✓ | ✓ | ✓ |
| automations | `/automations/reply-studio/auto-replies` | `/automations/reply-studio/auto-replies` | ✓ | ✓ | ✓ |
| automations | `/automations/reply-studio/bot-flows` | `/automations/reply-studio/bot-flows` | ✓ | ✓ | ✓ |
| automations | `/automations/reply-studio/business-hours` | `/automations/reply-studio/business-hours` | ✓ | ✓ | ✓ |
| automations | `/automations/reply-studio/new` | `/automations/reply-studio/new` | ✓ | ✓ | ✓ |
| automations | `/automations/reply-studio/reports` | `/automations/reply-studio/reports` | ✓ | ✓ | ✓ |
| ai | `/ai-assistant` | `/ai-assistant` | ✓ | ✓ | ✓ |
| analytics | `/analytics` | `/analytics` | ✓ | ✓ | ✓ |
| analytics | `/analytics/messaging` | `/analytics/messaging` | ✓ | ✓ | ✓ |
| analytics | `/analytics/campaigns` | `/analytics/campaigns` | ✓ | ✓ | ✓ |
| analytics | `/analytics/inbox` | `/analytics/inbox` | ✓ | ✓ | ✓ |
| analytics | `/analytics/automations` | `/analytics/automations` | ✓ | ✓ | ✓ |
| analytics | `/analytics/usage` | `/analytics/usage` | ✓ | ✓ | ✓ |
| integrations | `/integrations` | `/integrations` | ✓ | ✓ | ✓ |
| integrations | `/integrations/whatsapp` | `/integrations/whatsapp` | ✓ | ✓ | ✓ |
| integrations | `/integrations/api` | `/integrations/api` | ✓ | ✓ | ✓ |
| integrations | `/integrations/webhooks` | `/integrations/webhooks` | ✓ | ✓ | ✓ |
| billing | `/billing/wallet` | `/billing/wallet` | ✓ | ✓ | ✓ |
| billing | `/billing/subscription` | `/billing/subscription` | ✓ | ✓ | ✓ |
| billing | `/billing/invoices` | `/billing/invoices` | ✓ | ✓ | ✓ |
| settings | `/settings/workspace` | `/settings/workspace` | ✓ | ✓ | ✓ |
| settings | `/settings/team` | `/settings/team` | ✓ | ✓ | ✓ |
| settings | `/settings/roles` | `/settings/roles` | ✓ | ✓ | ✓ |
| settings | `/settings/whatsapp` | `/settings/whatsapp` | ✓ | ✓ | ✓ |
| settings | `/settings/security` | `/settings/security` | ✓ | ✓ | ✓ |
| settings | `/settings/audit-logs` | `/settings/audit-logs` | ✓ | ✓ | ✓ |
| redirect | `/` | `/dashboard` | ✓ | — | — |
| redirect | `/billing` | `/billing/wallet` | ✓ | — | — |
| redirect | `/billing/usage` | `/analytics/usage` | ✓ | — | — |
| redirect | `/settings` | `/settings/workspace` | ✓ | — | — |
| state | `/billing/wallet (no billing.read)` | `PermissionState` | ✓ | — | — |
| state | `/contacts (503)` | `ErrorState` | ✓ | — | — |

## Not verified

- Realtime updates on the production build: Chromium blocks the API WebSocket from a relayed page.
- The "Some services are degraded / API unreachable" toast in these captures appears in light runs
  through the relay too; its cause wasn't investigated (not theme-related).
- `/integrations/native/callback` (needs a real provider sign-in), a custom error page (none
  exists) and API invoice/receipt HTML styling stay out of scope.

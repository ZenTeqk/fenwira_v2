# Light mode: remaining screens and application-wide verification (2026-10-31)

Produced by `apps/web/e2e/light-mode-app-verification.spec.ts` against this branch (local stack;
the web app was served by `next dev` on :3000):

```bash
REVIEW_SHOTS_DIR=$PWD/docs/design/experience-v2/evidence/light-mode-app-verification \
  pnpm --filter @fenwira/web exec playwright test e2e/light-mode-app-verification.spec.ts
```

Each route is loaded at 1440, 768 and 375 px. A cell passes when the document has no horizontal
overflow (wide tables may scroll inside their own labelled region) and, at 1440 and 375, axe
(WCAG 2.2 A/AA tags) reports nothing. Results per route and width are in `routes.jsonl`;
screenshots are `<family>-<route>-<width>.png` (768 is captured for auth screens only).

Fixtures: new local accounts on the isolated stack. Nothing is sent, paid, invited or connected.
The MFA screen uses a placeholder challenge (a wrong code only returns an error); sign-in uses an
unknown account; access denied removes billing permissions in the browser only; the load-error
state is a mocked 503.

## Verified routes

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
Shared states and overlays (`overlay-*.png`, `state-*.png`): dialog focus moves in, Tab stays
inside, Escape closes and focus returns to the opener; the dialog fits at 375 px; command palette
and account menu open, are keyboard-operable and pass axe; access denied (`PermissionState`) and
load error (`ErrorState` with retry) pass axe. Sign-in and MFA server errors, the onboarding
country dropdown and validation are captured (`auth-*-error-*.png`, `onboarding-*`).

## Covered elsewhere, not in this sweep

| Routes | Where |
| --- | --- |
| `/contacts/[id]`, `/templates/[id]`, `/campaigns/[id]`, `/automations/[id]`, `/automations/[id]/history`, `/automations/[id]/edit` (canvas), `/integrations/webhooks/[id]` | Need records; covered by the module light-mode reviews (`light-mode-modules-review`, `light-mode-automation-review`, `light-mode-analytics-integrations-review`) |
| `/platform/*` (all operator routes) | `light-mode-billing-settings-platform-review` (#113), incl. 375/768 overflow |
| Managed Launch billing (`/billing/invoices` with UPI) | `light-mode-billing-settings-platform-review` |

## Blocked or not verified

| Route | Why |
| --- | --- |
| `/integrations/native/callback` | OAuth return from a provider; reaching it needs a real authorization, which this review does not trigger |
| `/dev/ui` | Gallery only with `ENABLE_UI_GALLERY=true`; not enabled on this stack |
| `[...slug]` planned-module preview | Development-only (`NEXT_PUBLIC_NAV_PREVIEW`); otherwise a 404, which is verified |
| Application error page | No `error.tsx`/`global-error.tsx` exists; Next's default is used. Not invented here |

## Defects fixed in this change

- Dialogs and drawers opened from ordinary buttons returned focus to `<body>` on close (Radix only
  restores to a `Trigger`); a field with `autoFocus` also hid the opener. `ModalContent` and
  `DrawerContent` now return focus to the opener (`packages/ui/test/modal-focus.test.tsx`).
- `/settings/roles` at 375 px: the scrolling permission table wasn't keyboard-reachable (axe
  `scrollable-region-focusable`); it is now a labelled, focusable region.
- Invalid invitation page had no `h1`; it now uses `AuthCard`.
- Session loading screen put `aria-label` on a role-less `div` (axe `aria-prohibited-attr`); it is
  now `role="status"`.

## Production build

`next build` passes. The build was served with `next start` on :3001 (`ENABLE_UI_GALLERY=true`);
the developer's `next dev` on :3000 was left untouched. Signed-in routes reach the local API through
the spec's opt-in `E2E_WEB_UPSTREAM` relay (the page keeps the `localhost:3000` origin the API
accepts; redirects and failed relayed requests behave as in a browser).

```bash
E2E_WEB_UPSTREAM=http://127.0.0.1:3001 pnpm --filter @fenwira/web exec playwright test e2e/light-mode-app-verification.spec.ts
E2E_BASE_URL=http://127.0.0.1:3001 pnpm --filter @fenwira/web exec playwright test e2e/keyboard.spec.ts e2e/a11y.spec.ts e2e/responsive.spec.ts -g "dev/ui|Dropdown|Modal|Tabs|ConfirmDialog|open overlays"
```

| Check | Result |
| --- | --- |
| Light-mode smoke (`light-mode-app-verification`, every route family at 375/768/1440, overflow + axe, overlays, focus) | 4/4. The route sweep passed on re-run; its first run missed one `h1` under the relay (`/integrations/whatsapp`, which renders every time in isolation) |
| Gallery: keyboard (dropdown, modal, tabs, confirm), axe (page and open overlays), responsive at 375/768/1024/1440 | 10/10 |

Screenshots and `routes.jsonl` above come from the earlier `next dev` run; no new screenshot sweep
was made.

## Existing regression suites (this branch)

Passed: `keyboard`, `a11y` (incl. open overlays), `responsive` (gallery checks on the production
build), `shell-consistency`, `contacts`, `platform-console`, `platform`, the five earlier light-mode
review specs, `auth` 6/6, `design-system` 5/5, `tenancy` 3/3, `billing-reconstruction` 2/2,
`subscription` 1/1.

Six assertions were stale after intended changes on `main`; each behaviour was confirmed before
the assertion was updated, with no coverage removed:

| Test | Intended behaviour (source) | Update |
| --- | --- | --- |
| `auth` › wrong passwords, forgot password | Plain-English API error copy (`error-copy.ts`, 9819e74) | Expects "The email or password is not correct." |
| `design-system` › shell | Sidebar WhatsApp status became a labelled link (#114) | Asserts `WhatsApp: Not connected / Connected. View connections`, as `application-shell` does |
| `tenancy` › invite a teammate | Invitations return a one-time link to share; email only if SMTP is set up (ADR-0027 step 4) | Creates the invitation, reads the link from "Share the invitation link" and accepts through it |
| `billing-reconstruction` › wallet | One page-title size for every module (bcfe9be; `shell-consistency` checks equality) | Expects 24 px |
| `subscription` | Plans show a configured price or "Pricing: contact us" | Deterministic prices: real plans with prices set by the test; adds a priced check (`₹1,499.00 / month`) |

## Not verified

- Realtime updates in the production run: Chromium blocks the API WebSocket from a relayed page
  (local-network-access), so live updates were only exercised on `next dev`.
- `/integrations/native/callback` (needs a real provider sign-in), a custom application error page
  (none exists; Next's default is used), and the routes listed under "Blocked or not verified".

## Dark theme

The same route matrix, module reviews and gallery checks pass with the root forced to dark:
[dark-mode-verification/README.md](../dark-mode-verification/README.md).

## Follow-up

API-generated invoice and receipt HTML (`apps/api/src/modules/billing/invoice-document.ts`) uses
its own greys (`#18201D`, `#4B5550`, `#D6D9D4`), close to but not the token values. Backend change,
left as is.

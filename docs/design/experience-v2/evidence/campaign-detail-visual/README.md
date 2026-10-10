# Graphical campaign detail review — 8 October 2026

The existing View campaign report now presents actual API data as compact result cards, a delivery funnel, audience/timing context and recorded milestones beside the approved WhatsApp mobile preview. This is a new graphical detail presentation, not a claim of exact fidelity to the campaigns list reference.

## Review

- [Desktop](completed-1440.png), [1024](completed-1024.png), [tablet](completed-768.png), [mobile](completed-375.png).
- [Scheduled](scheduled-1440.png), [funding pause](paused_insufficient_funds-1440.png), [template pause](paused_template_unavailable-1440.png), [failed](failed-1440.png).
- Synthetic workspace: **Fenwira Textiles — Local Demo**. Existing demo account instructions are in [the textile fixture](../textile-campaign-demo/README.md).
- Completed example: `http://localhost:3000/campaigns/01a1179a-3847-7373-8caa-8109f1c97fa3` after signing into that workspace. No new campaigns or customer sends were required for these screenshots.

## Data interpretation

Sent, Delivered and Read are inclusive counters, displayed against the same eligible audience. Rates remain server-defined, with their denominators explained in the view. Waiting includes pending plus queued/sending. Unprepared audiences have explanatory copy and no progress bars. Milestones use persisted timestamps only; paused/failed timestamps are unavailable. The frozen template preview preserves unresolved variables and uses the authorized signed image sample. Phone chrome is illustrative; no calls or messages are sent by preview controls.

## Concrete validation

- Production Docker frontend build and health check: passed; local frontend restarted.
- Web typecheck and lint: passed.
- Web unit tests: **18 passed across 5 files**.
- Design token and dependency boundary checks: passed; `git diff --check` passed.
- Campaigns reconstruction browser suite: **3 passed** (read-only permissions, loading/error/empty, 200-record stress).
- Campaign lifecycle browser regression: **1 passed**, including new assertions for all three bars at 2/2, frozen variable markers and completion milestone. An initial ambiguous Delivery rate selector was corrected to exact label matching; no runtime issue was involved.
- Opt-in campaign detail visual review: **1 passed**, covering 1440/1024/768/375 widths, no document overflow, WCAG 2.2 A/AA axe checks, completed/scheduled/funding-pause/template-pause/failed views, stats failure without fabricated progress, keyboard menu opening/Escape/focus return.
- Local smoke: passed API readiness, frontend/sign-in rendering and outbox → queue → worker round trip.

Run the local visual review with:

```sh
EV2_CAMPAIGN_DETAIL_REVIEW=true pnpm --filter @fenwira/web exec playwright test campaign-detail-visual.spec.ts
```

The opt-in visual test needs the existing persisted local textile fixture and performs read-only UI review. The regular lifecycle and reconstruction tests create isolated synthetic tenants. No backend, contract, schema, ledger, subscription policy or enforcement configuration change. No Phase 11 closure was executed. Stop at Campaigns visual review.

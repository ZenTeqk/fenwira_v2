# Automations visual checkpoint — 8 October 2026

**Ready for visual review.** The Campaigns approval authorized this checkpoint; Analytics has not been started.

## Module and reference decomposition

Reference: `07-Automation-Studio.png`. The composition is a searchable step library, central warm dotted canvas with white icon-led nodes, selected-step settings, compact controls/minimap and a restrained action header. Automations now uses the canonical approved 224px sidebar/56px topbar variant; earlier approved module routes retain their behavior. The shared BuilderPage has an optional joined studio appearance; its default presentation remains unchanged.

## Visual changes and geometry

Desktop library is 208px, settings 320px, and the canvas takes the remaining width. The desktop canvas is 704px high, with readable message summaries, labelled branches, arrowheads and emerald selection. Library and long settings scroll within their own regions. At 1024/768, settings move to a modal and the canvas remains primary. At 375, the initial view is the keyboard Outline, with settings in a focus-trapped modal.

## Data, functionality and intentional product differences

All flow data comes from existing tenant-scoped APIs. The 18-node catalog, graph format, optimistic If-Match autosave, validation, published-version immutability, execution history and replay remain authoritative. Save flushes the same adapter; Publish confirms its impact. Actual all-time total/running counts replace unsupported concept metrics. The one-trigger rule means the library hides additional triggers after one exists.

AE1 excludes the concept's Customer replied? / wait-for-reply. Wait remains a fixed durable delay. No simulator/Test action or daily completion/attention metric is invented. Message/template previews preserve expression markers; approved template header samples use the existing permission-gated signed URL service. No fabricated customer sample values.

Two reproduced UI issues were fixed and tested: controlled React Flow node measurements were discarded, leaving the minimap empty; settings-modal dismissal returned focus to BODY. Measurements are now retained only in browser state, never saved into the graph, and dismissal returns focus to the opener or current view tab. Draft-read failures now show retry rather than an indefinite skeleton.

## Local review workflow

An **unpublished draft** named **Textile enquiry follow-up** was created in the existing **Fenwira Textiles — Local Demo** workspace through authenticated APIs. It has an incoming-message trigger, tag condition, greeting, two-hour timed wait, tag action and two End branches. It has not been published and has no execution history or actual sends.

Open `http://localhost:3000/automations/01a11997-da14-7cd3-bc72-275466be042d` after signing into the [existing textile demo account](../textile-campaign-demo/README.md). Select Send message to inspect the form and preview. General browser tests create separate synthetic tenants; the opt-in `EV2_AUTOMATION_TEXTILE_DEMO=true` fixture path requires localhost and the synthetic manifest.

## Responsive and accessibility evidence

- [1440 × 1000](studio-1440.png), [desktop full page](studio-1440-full.png).
- [1024 settings](studio-1024.png), [1024 workspace](workspace-1024.png).
- [768 settings](studio-768.png), [768 workspace](workspace-768.png).
- [375 settings](studio-375.png), [375 Outline](workspace-375.png).
- [Machine-readable review](validation.json): zero WCAG 2.2 A/AA axe violations and no document horizontal overflow at all four widths; keyboard focus returns after Escape at the smaller widths. The minimap contains all seven measured node shapes.
- [First pass](first-pass/studio-1440.png) shows the toolbar wrapping and empty minimap before correction. It is retained separately from the final captures.

The approved shell, semantic typography/controls and surface treatment align with Home/Inbox/Contacts/Campaigns. The runtime restrictions and actual synthetic data intentionally differ from the conceptual reference; this is not an exact-match claim.

## Concrete validation

- Web and shared UI lint/typecheck: passed.
- Shared UI tests: **55 passed across 6 files**.
- Web tests: **18 passed across 5 files**, including graph auto-layout invariance.
- Design token checks, dependency boundaries and `git diff --check`: passed.
- Final browser suite: **5 passed**: responsive studio/minimap/focus/error handling; read-only UI and server publish denial; create/publish/actual simulated reply/history/replay; keyboard-only Outline; Campaigns create/launch/delivery/report regression.
- Production Docker frontend build/restart: passed, healthy.
- Local smoke: passed API readiness, frontend/sign-in rendering and outbox → relay → queue → worker.
- No backend/domain/schema/worker/billing/subscription configuration changes. No Phase 11 closure or external deployment.

Run the normal browser checks with:

```sh
pnpm --filter @fenwira/web exec playwright test automation.spec.ts automation-reconstruction.spec.ts campaigns.spec.ts
```

Commit is recorded in Git for this module-specific checkpoint. Stop for Automations visual review.

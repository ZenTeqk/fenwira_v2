# Home scale and density refinement

The user approved the reconstructed Home direction at `408dfd0`. This task refines its dimensions, preserving the 70:30 and approximately 44:56 composition, colors, surface hierarchy, real data and communication character. Only Home and its visible shell change. No scaling, zoom, root font reduction or viewport substitution.

## Scale changes

| Object | Before (`408dfd0`) | Refinement |
| --- | --- | --- |
| Home sidebar | 240px | 224px; other modules stay 232px |
| Home logo | 32px mark / 24px wordmark | 28px mark / 20px wordmark, same artwork |
| Navigation | 44px rows / 20px icons / 16px labels | 36px / 18px / 14px, existing shared sizes |
| Topbar | 64px | 56px; search and account targets remain unchanged |
| Main gutters | 24px desktop / 16px mobile | Preserved |
| Main vertical padding | 24px | 20px |
| Greeting | 30/36 bold | 24/32 semibold |
| Supporting copy | 18/28 | 14/20 |
| Section headings | 18/28 | 16/24 semibold |
| Attention/customer/flow titles | 16/24 | 14/20 semibold; body stays 14/20 |
| Surface content padding | 20px horizontal | 16px; summary retains its already compact padding |
| Surface headers | 52px nominal | 48px nominal; 12px vertical padding retained |
| Attention row padding | 16px vertically | 12px vertically; action still wraps on mobile |
| Attention minimum height | 288px | Removed; desktop paired surfaces follow content |
| Attention icon container / icon | 48px / 20px | 32px / 16px |
| Activity icon / row gap | 40px / 16px | 32px / 8px |
| Conversation avatars | 40px | 32px, same deterministic colors |
| Conversation rows | 65px including divider | 61px including divider; four previews and full Inbox links preserved |
| Automation icon / row gap | 48px / 16px | 32px / 12px |
| Campaign delivery/read values | 18/28 | 16/24; progress and actual counters retained |
| Header actions | 40px | 36px desktop, 40px mobile |
| Band gaps | 16px | Preserved; already compact |
| Metadata / metric values | 12–13px / 20px | Preserved for legibility |
| Radii, borders, colors, depth | Approved semantic foundation | Preserved |

## Visual comparison

The new production 1440×1000 capture was visually compared with the original concept and the approved `408dfd0` reconstruction. It retains the 70:30 attention/update band and approximately 44:56 conversation/campaign-summary band, varied avatars, semantic tints, subtle depth and automation strip. Smaller objects sharpen the hierarchy without removing communication identity. Campaign read rates, timestamps, conversation ordering and current updates may differ between runs because the fixtures use actual asynchronous domain responses.

All primary surfaces and the health footer now fit within the 1000px viewport. From the greeting to the automation strip's bottom, the approved screenshot spans approximately 920px (y88–1008); the final DOM spans 836px (y76–912), about **9.1% less vertical space**. This is a composition measure, not uniform scaling. The main content width grows from 1152px to 1168px as the sidebar narrows; the canvas keeps its normal minimum viewport height.

The attention/activity band falls from approximately 330px in the retained capture to **294px** measured in the final DOM; conversation surface from approximately 348px to **336px**; campaign from approximately 180px to **172px**; automation from approximately 118px to **98px**. Desktop band gaps stay 16px. Individual conversation rows measure 61px including the divider, down from 65px. The paired conversation surface stretches to the adjacent campaign/summary stack, preserving the approved alignment; it is not forced to an independent minimum height.

The [three-stage desktop comparison](experience-v2/evidence/home-density/README.md) retains the concept, approved reconstruction and final compact view. Baseline geometry comes from the retained screenshot and source; final geometry is directly measured in [home-geometry-1440.json](experience-v2/evidence/home-density/home-geometry-1440.json). This is ready for visual review, not a claim of user approval.

## Responsive and accessibility

All four final screenshots were visually inspected. **1024:** 224px sidebar and 56px topbar remain; operational sections stack with readable previews and controls. **768:** sidebar becomes its existing drawer, page sections stack, header actions wrap beneath the greeting. **375:** 16px gutters, readable 14px body, 40px header actions and vertically wrapped attention links; metrics use two columns and automation metadata wraps. No horizontal page overflow at any width.

Populated Home has **zero Axe WCAG 2.2 AA violations at 1440/1024/768/375**. Authenticated Lighthouse accessibility is **100 for Home and 100 for Inbox**, protected final URLs verified; [sanitized results](experience-v2/evidence/home-density/accessibility.json) retain no browser secrets. Keyboard tests preserve visible focus, overlay focus management, Escape, command palette navigation and collapsed/sidebar drawer behavior.

Shared defaults are preserved outside Home; no global Avatar, Button, Card, MetricCard or token change. `DashboardLayout` has Home as its sole application consumer. The Home-specific oversized navigation variant is removed in favor of existing shared sizes; other modules keep their 232px sidebar and prior geometry. Inbox behavior is checked as regression only.

## Tests

- `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`: **pass**. Unit aggregate: **299** (UI 53, web 15, API 130, contracts 40, config 16, WhatsApp 33, database 3, queue 5, worker 4). Changed UI/web tasks executed during this refinement; unchanged Turbo tasks use existing cache. Existing Radix Tabs `act(...)` warnings remain visible. Module boundary and design-token checks pass.
- Final production `docker compose build fenwira-web` and healthy web restart: **pass**, **51 routes**, **3 uncached successful build tasks**, **1m14.477s** task time. Docker/Node 22 production path checked; this is not a remote CI or clean-volume deployment claim.
- Final browser command: `EV2_LIGHTHOUSE=true pnpm --filter @fenwira/web exec playwright test home-reconstruction.spec.ts experience-v2.spec.ts responsive.spec.ts keyboard.spec.ts design-system.spec.ts smoke.spec.ts tenancy.spec.ts a11y.spec.ts campaigns.spec.ts`: **56 passed (3.7m), zero failures/skips**. Coverage includes persisted Home records and actual campaign launch/delivery/pause, draft-progress honesty, Home error states, four-width accessibility/overflow, keyboard/overlay navigation, collapsed rail persistence, tenant switching/cache clearing and Inbox reply/note, read-only permissions, draft preservation and offline recovery. No tests weakened; the old Home width expectation changes from 240px to the intended 224px. The intermediate compact Home run passed both cases (17.6s); it is not counted again in this aggregate.
- `pnpm smoke`: **pass**, API dependencies, rendered web sign-in and persisted outbox → relay → queue → worker round trip. All **8 local services healthy**. `BILLING_ENFORCED=false` and `BILLING_SUBSCRIPTIONS_ENFORCED=false` confirmed in the API container.
- No backend/schema change; full database integration/Phase 11 closure suites are not rerun or claimed for this presentation refinement.

## Domain changes

**None.** No data query, contract, backend, database, campaign/automation engine, messaging, eligibility, wallet/subscription, analytics definition, RBAC/RLS or rollout flag changes. No Inbox or later-module presentation changes. Existing Home browser fixtures continue to use actual local domain APIs and mock-provider responses.

## Evidence

New screenshots are retained separately under [experience-v2/evidence/home-density/](experience-v2/evidence/home-density/README.md). The approved reconstruction screenshots stay untouched.

Stop for visual review after this refinement.

## Measurement-led iteration

The first production capture showed the complete Home at 1440×1000 with its original composition. Its row measurements revealed that timestamp/status spacing still forced 65px conversation rows. A final targeted change reduces that gap from 8px to 4px and tightens the current-update timeline gap to 8px, rather than shrinking body copy further. The initial compact desktop capture is retained separately. Final DOM geometry and screenshots follow the passing browser run.

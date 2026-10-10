# Home reconstruction — visual review pending

The foundation and fidelity correction are engineering baselines, not visually approved results. Scope is Home and the shared shell visible on Home only. Reference: [01-Home.png](experience-v2/01-Home.png). No domain, schema, authorization or policy changes are authorized.

## Home Reference Decomposition

Direct inspection of the 1505×1045 reference and latest 1440-wide implementation, before changing presentation:

- Canvas: warm neutral; sidebar roughly 16% (241px), main gutters roughly 24px, content uses almost all remaining width. Topbar about 62px; greeting begins 28px below it. Bands separated by about 16px.
- Sidebar: near-white surface, fine right border; large brand near top left; 40–44px navigation rows, approximately 20px icons and 16px labels. Emerald selected background. Divider after Analytics; connection, wallet and account anchored at bottom. Existing Fenwira artwork remains authoritative.
- Header: greeting approximately 30/36 bold, supporting copy approximately 18/24 muted; right-aligned message and creation actions. Search occupies the topbar center rather than the far right.
- Grid: attention/activity roughly 70:30; second band conversations/right stack roughly 44:56. Right stack contains campaign then a compact four-value summary. Automation spans the bottom.
- Attention: fine bordered white object, approximately 52px header, 20px padding, four approximately 73px rows, 48px semantic round icons. Strong row titles, secondary descriptions, contextual detail in the middle and aligned actions on the right. No fixed fictional row count should be imposed.
- Activity: compact timestamp-led timeline, circular semantic icons, clear title/detail hierarchy. Reference represents events; existing data supplies current states and update times, which must remain explicitly labelled.
- Conversations: four approximately 68px rows, 44px avatars, name/message hierarchy, time and unread count aligned right. Current implementation adds assignment as a third line and expands five rows across the whole page.
- Campaign: distinct operational object approximately 185px high, title/status, actual progress and compact delivery/read/reply facts. Current campaign list lacks delivery/progress facts; existing stats endpoint may supply these. No invented progress.
- Metrics: secondary strip about 136px high, four divided columns, modest values. Reference says Today; current analytics is seven-day and must retain that honest period. No decorative sparklines.
- Automation: roughly 128px full-width strip with identity, status and execution count. Reference graph cannot be inferred from the flow list; use real flow identity and counts, with run-history navigation.
- Shape/elevation: approximately 10–12px panel radius, light borders, very subtle depth. White surfaces dominate; emerald used for actions, selection and real progress. Blue/red/amber/green support specific meanings. Warm canvas is not a tinted dashboard background.
- Human character: clear greeting, varied avatars, communication previews and action-led rows. Do not synthesize photographs, team members, elapsed waiting times or historical events.

## Visual Difference Log

| Area | Reference | Current baseline | Difference | Correction |
| --- | --- | --- | --- | --- |
| Composition | Three compact bands | Long generic stack, 1296px page | Operational bands become unrelated stacked cards | Independent attention/activity and conversation/campaign-summary bands; automation footer |
| Header | Prominent welcome and two actions | Small Home heading and campaign action | Greeting loses prominence and operational balance | Greeting presentation, honest supported message/create links |
| Conversations | Narrow, dense, two-line rows | Full-width, three-line rows | Rows occupy too much width and height | Two-line communication rows; preserve assignment access in Inbox |
| Campaign | Distinct summary object | Timeline only | Operational progress loses its own visual hierarchy | Separate supported campaign snapshot and update timeline |
| Metrics | Secondary right-hand strip | Full-width last section | Secondary numbers create an extra full-page band | Compact summary beneath campaign, labelled seven-day period |
| Automation | Horizontal identity/run summary | Large timeline | Identity and run summary become oversized | Compact real flow summaries, no fabricated graph |
| Shell | Taller, more spacious Home navigation/search | 232px/56px generic shell | Navigation and centered search proportions differ | Home-only geometry variant; keep other modules unchanged |

## Validation and evidence

Implementation has completed four screenshot-driven passes. Final validation results are recorded below; visual approval remains a user checkpoint.

## Screenshot iterations

1. **Iteration 1:** production capture retained at `home-reconstruction/iteration-1-1440.png`. The grid is rebuilt, but the five three-line-scale communication rows and verbose summary leave a 1219px page; campaign-only activity is sparse and search remains too far right.
2. **Iteration 2:** retained at `home-reconstruction/iteration-2-1440.png`. Actual current conversation, flow and campaign updates replace the one-source timeline. Four communication previews, shorter metric labels, distinct campaign results and a horizontal automation identity improve the bands. The four-width check catches **86px overflow at 1024px** from the desktop search/spacer; it is not accepted as passing.
3. **Iteration 3:** narrower search/spacer at 1024; approximately 44:56 lower band; compact row/summary geometry; analytics freshness moved into the summary header. The review fixture now imports actual mock-provider approved/rejected templates and launches, delivers and pauses a real rate-limited campaign. Progress and attention reflect domain responses. Unlaunched-campaign honesty has its own browser check. The initial fixture attempt used a nonexistent flat WABA identifier; it was corrected to the existing `connection.waba.id`. The populated four-width capture and draft case then passed.

4. **Iteration 4:** inspection of the 375px capture showed narrow attention text beside fixed-width actions. Actions now move beneath their text at small widths; desktop alignment is retained. Final browser/evidence checks use this build.

## Composition, typography, surfaces, color and spacing

`DashboardLayout` now provides Home-specific composition slots rather than forcing campaign, conversations and automation through one generic stack. Attention/current updates use 70:30; communication and the campaign/summary stack use roughly 44:56. All narrow widths stack by operational priority. The welcome heading is 30/36 bold, section titles 18/28 and customer/attention identities 16/24. Communication previews retain time and unread/status metadata but omit the extra assignment line; full assignment remains in Inbox. Four latest previews link to real conversations.

Fine bordered white communication surfaces, open-header campaign/automation objects and a divided secondary summary have different internal geometry. Existing semantic tints distinguish conversation updates, campaign identity and flow identity; no new palette, gradients or decorative charts. Existing varied avatars represent actual names, without synthesized photographs or staff stacks. Home shell alone uses 240px navigation, 44px rows, 20px icons, a larger existing brand mark, 64px topbar and centered desktop search. Other routes retain their existing shell geometry. 16px band gaps, denser row padding and shorter summary labels replace repeated large section gaps.

## Components and functionality

Reuse Button, Card surface, CardTitle, Avatar, StatusBadge, Progress, ErrorState, Skeleton, PageHeader and the existing shell/search/account/status components. Refactor only DashboardLayout and Home presentation components; no new design framework. Current activity is explicitly labelled as updates, not fabricated event history. Existing query keys share current conversation/flow reads. Disabled permissions also exclude cached sources from the activity aggregation. Conversations without a message timestamp do not supply activity time. Campaign delivery/read rates use the existing stats endpoint; `sent` is already cumulative and must not add delivered/read again. No draft progress, fictional reply count, inferred graph, invented wallet value, production pricing or policy.

Supported differences remain explicit: no unified historical event API, no avatar photos/team stack, no graph in the flow list, seven-day rather than Today metrics, actual canonical status categories, and no wallet footer amount when charging is disabled. The primary attention object only renders real issues, so its density varies by workspace. Domain actions, API contracts, RBAC/RLS, realtime, offline recovery and draft guards remain authoritative.

## Domain changes

**None.** No API/worker/contracts/schema/migrations, messaging eligibility, wallet/subscription logic, analytics definitions, campaign/automation domain or security changes. No production rollout flag is enabled. No Inbox or later module presentation is modified. Existing browser expectations change only for the Home greeting, shortened seven-day labels and four-preview selection; assertions remain, navigation checks account for the Home-only greeting/width, and a real cumulative campaign-progress check is added to the launch/delivery browser flow.

## Accessibility and verification

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm format:check`: **pass** on the final source. **299 unit tests** in aggregate: UI 53, web 15, API 130, contracts 40, config 16, WhatsApp 33, database 3, queue 5, worker 4. Changed web/UI tasks execute during this task; unchanged Turbo tasks reuse their existing cache. Existing Radix Tabs `act(...)` warnings remain visible. Dependency boundaries and design-token checks pass. No raw feature colors/arbitrary values are introduced.
- Final production Docker web build: **pass**, **51 routes**, **3 uncached successful tasks**, **53.675s**. The final container is healthy. This verifies the Docker/Node 22 production path, not a remote CI run or clean-volume deployment.
- `pnpm smoke`: **pass** — API readiness, web/sign-in, and actual outbox → relay → queue → worker round trip. All **8** local services are healthy. `BILLING_ENFORCED=false` and `BILLING_SUBSCRIPTIONS_ENFORCED=false` verified in the running API.
- Third-pass populated capture: **2 browser tests passed (13.2s)**, including actual supported campaign progress and a separate no-fictional-draft-progress case. No WCAG 2.2 AA Axe violations or page overflow at 1440/1024/768/375. This intermediate run is not counted again in the final aggregate.
- Final selected browser command, including authenticated Lighthouse: `EV2_LIGHTHOUSE=true pnpm --filter @fenwira/web exec playwright test home-reconstruction.spec.ts experience-v2.spec.ts auth.spec.ts smoke.spec.ts keyboard.spec.ts responsive.spec.ts design-system.spec.ts analytics.spec.ts campaigns.spec.ts tenancy.spec.ts a11y.spec.ts`. **62 passed and 2 failed (4.5 minutes)** on the aggregate run. The two failures were outdated presentation expectations (Home breadcrumb and 232px width); they now assert the greeting/route and 240px Home width. Targeted rerun: `pnpm --filter @fenwira/web exec playwright test keyboard.spec.ts responsive.spec.ts --grep 'CommandPalette navigates|sidebar collapses'`: **2 passed (9.8s)**. Thus all **64 unique selected cases** are verified, with no skips; this is not a claim that the original aggregate command exited successfully. No production source changed after that run, and final web lint/format checks pass. Coverage retains actual campaign launch/delivery and cumulative Home progress; permission-sensitive navigation; retry/empty/unprocessed states; tenant switching/cache clearing; keyboard/focus/overlays; mobile drawer and collapsed rail; four-width Axe/overflow; and actual Inbox reply/note, draft preservation and offline recovery. New Inbox styling is outside this task; these are regressions only.

No new backend/database integration suite is claimed for this presentation-only task. Accepted domain implementation and RLS remain unchanged; the real browser stack exercises existing contracts and tenancy. No Phase 11 closure milestone is executed or declared.

- Final Home review case: **9.6s**, draft honesty case **2.0s**, with zero Axe WCAG 2.2 AA violations and no page overflow at all four requested widths. All final screenshots were visually inspected, including corrected mobile action wrapping. Authenticated Lighthouse 12.8.2: **Home 100**, protected final URL verified; preserved Inbox regression also scores 100. [Sanitized results](experience-v2/evidence/home-reconstruction/accessibility.json). These scores do not establish visual approval.

## Evidence

The [review index](experience-v2/evidence/home-reconstruction/README.md) places the approved Home and new implementation side by side, followed by untouched initial and previous fidelity captures. New final Home captures: [1440×1000](experience-v2/evidence/home-reconstruction/home-1440.png), [1024](experience-v2/evidence/home-reconstruction/home-1024.png), [768](experience-v2/evidence/home-reconstruction/home-768.png), [375](experience-v2/evidence/home-reconstruction/home-375.png). Full-page images may exceed the viewport height so all supported objects remain reviewable. Iterations retain before-correction evidence. Raw logs, browser profiles and traces stay in ignored test output; no root log files are added.

**Ready for visual review.** No visual approval is inferred from engineering results. Stop before Inbox or later module reconstruction.

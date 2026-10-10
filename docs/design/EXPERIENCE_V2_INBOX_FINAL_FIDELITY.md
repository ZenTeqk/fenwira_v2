# Inbox final visual fidelity pass

## Reference decomposition before implementation

The reconstruction in `e50211a` is **not visually approved**. Its 176/320/flexible/256px panes and approved Home shell are retained. The concept's compact avatar-led rows, short communication header, lightly textured thread, clear emerald messages, minimal resting composer and customer-first context guide this pass. The reference's shell/logo/footer, team queues, calls, product cards, typing indicators and fabricated photos do not authorize product changes.

The reconstructed populated capture has 89px standard / 117px selected rows, 32px list avatars, a 209px combined thread header, and a 165px resting composer. Healthy window/assignment/takeover strips and universal list metadata consume too much vertical space. Eligibility plus separate consent dominate context before notes/history. The plain thread and muted messages lack the reference's communication character.

Planned focused changes: two-line rows with 36px deterministic avatars and secondary states in accessible details; 60–72px primary header with compact assignment/action controls and consolidated contextual metadata; quiet healthy window and takeover, stronger existing exceptional states; an original low-opacity geometric SVG texture; slightly richer outbound-only token with verified text/status contrast; single-line auto-growing reply/note writing surface bounded at 160px, integrated tools and compact mode selector; customer identity/assignment/tags ahead of compact WhatsApp disclosure, real notes and history.

`contactSchema` and `conversationSchema` expose no supported profile image URL. No photo infrastructure or fake images will be added. The centralized eligibility hook and existing summary remain authoritative; an Inbox-specific compact presentation must not change other Contacts surfaces. Home and its shell are untouched. No backend, contracts, schema, domain, RBAC, RLS, billing enforcement or later-module changes.

## Validation plan

Perform two deliberate production-build/screenshot comparisons at 1440×1000 before the final responsive review. Retain all historical evidence and new cycle images separately. Measure actual before/after row, avatar, primary/contextual header, composer resting/maximum, identity/eligibility and pane dimensions. Extend the populated browser fixture with textarea growth/cap/shrink, compact geometry, disclosure keyboard and existing private-note/mobile assertions. Preserve existing offline/draft/lock/window/permission coverage. Run lint, typecheck, format, units/contrast, Inbox integration, relevant browser/accessibility/responsive checks, Docker web build and smoke. Record exact results and limitations; **Ready for visual review**, then stop.

## Implementation and measured density

| Dimension at 1440×1000 | Reconstruction before this pass | Final fidelity |
| --- | --- | --- |
| Standard conversation row | 89px | 65px |
| Selected assigned/takeover row | 117px | 65px |
| List avatar | 32px | 36px |
| Primary identity/action header | Approximately 66px from source/retained capture; not separately exported | 64px, exported from DOM |
| Combined thread header | 209px | 130px |
| Service window / takeover presentation | Separate window/assignment/tag and takeover strips; not separately exported | One 65px contextual area including tags and takeover; healthy window itself is 16px inline text/icon |
| Composer resting height | 165px | 101px |
| Writing surface at rest | Two rows, 48px minimum | 42px measured, 40px CSS minimum |
| Writing/composer maximum in normal mode | Fixed two-row writing surface; no auto-grow | 160px writing cap / 219px complete composer, then internal writing scroll |
| Context identity area | 68px from unchanged source structure; not separately exported | 68px, including full phone and Open contact |
| Context eligibility/consent | Two permanently open sections; heights not separately exported | 121px compact WhatsApp section, with complete details in a keyboard disclosure |
| Views / list / thread / context | 176 / 320 / 424 / 256px | Unchanged |
| Global sidebar / topbar | 224 / 56px | Unchanged |

Final values are browser DOM measurements of the populated, assigned/takeover fixture. The reconstruction's existing geometry file supplies the exported before values. Separately unrecorded baseline heights are explicitly labelled rather than presented as measurements. Expanded composer measurement is for normal Reply mode without exception banners; warning, locking, connection and template-required states may need additional height. No arbitrary fixed row height, browser zoom or global scale change is used.

The combined header and resting composer release **143px more vertical conversation space** (209+165 → 130+101). Nine persisted conversations now fit comfortably rather than being crowded by mandatory operational metadata. Body text remains 14/20 and metadata 12–13px. Ordinary and selected rows have the same compact geometry while selection/unread remain distinguishable by tint/accent, weight, label and count.

## Conversation list and avatars

Names, previews, timestamps and unread counts lead two-line rows. Universal assignment/window/takeover/pending lines move to row details and the selected conversation's header/context; the supported views/status/unread/search queries are unchanged. The row keeps full assignment/takeover/pending information in its accessible text and supplementary native details. Avatar colors remain deterministic identity decoration, with 36px customer initials. No backend-supported customer/profile photo URL exists in either contact or conversation contracts, so no photo infrastructure or fabricated profile images are added. List header spacing is lighter; dropdown filters remain supported controls rather than fabricated tabs/counts.

## Header, message surfaces and composer

Compact identity, masked phone and actual status sit alongside the assignee avatar control, Resolve/Reopen and More. Assignment menus, snooze/pending/tags/takeover mutations and their permissions are unchanged. Full assignee identity is in the accessible name/title and context. Below identity, healthy window countdown and stored conversation tags share one quiet line. Takeover/paused state and Return to automation share a compact contextual line, with the automation explanation available in details/accessible text. Existing composer warnings still make near-expiry, expired, template-only, disconnected and restricted states prominent.

The thread's original 64px repeating SVG contains tiny message curves, geometric crosses and dots: existing secondary color at 5% opacity, no external image, no animation, hidden from assistive technology and no pointer interception. Incoming messages remain bright white with a fine border/subtle depth. Outgoing messages use the slightly richer outbound-only `message-outbound` surface **#D2F2DF**, previously #DDF4E8. No other page consumes this token; Home and all shared primitive defaults stay unchanged. Padding decreases from 10 to 8px vertically; sender/event gaps from 12 to 8px, while same-sender grouping remains unchanged. Five-sixths maximum width and natural short-message width are preserved. Warm Internal note surfaces keep explicit author/private labels with matching compact padding. Timestamps/status labels and ticks remain secondary but readable.

Actual outbound foreground contrast ratios: body **13.86:1**, secondary metadata **6.45:1**, sent/info **5.59:1**, read/delivered **5.94:1**, failure **5.39:1**. Existing executable token tests pin the new value and verify every actual message/status pairing at AA. Decorative pattern marks carry no status or text meaning; every message has an opaque readable surface.

The composer integrates tools and Send beside a one-line writing surface, with a compact Reply/Internal note selector above. Auto-growth observes typing/canned insertion, mode changes and available-width changes; 160px maximum writing height prevents it taking over the thread. Clearing/success shrinks it. Existing Enter/Shift+Enter, compose locks/heartbeats, draft state, pending/busy behavior, optimistic reconciliation, uploads, templates and canned-reply insertion/sending remain intact. All supported tool actions have accessible labels and supplementary titles; no unsupported emoji picker is introduced. Note mode keeps a warm surface and explicit private placeholder. Toolbar and mode targets are 40px on mobile; primary identity/actions use a separate row in narrow thread containers so the customer name remains readable, including 1024 and mobile.

## Customer context and real activity

Compact customer identity/full authorized phone/Open contact precedes assignment and stored contact tags. The Inbox-specific WhatsApp view consumes the existing centralized server eligibility hook; compact service/marketing verdicts remain visible, and a blocked service reason stays explicit. A native disclosure provides the unchanged full EligibilitySummary, restriction reasons, utility verdict and both consent statuses. The Contacts component's default presentation and permission gates are untouched. Keyboard Enter toggles details and full details are checked for AA; mobile drawer focus restoration stays intact.

Real contact notes show compact author avatars, timestamps and text; existing other-conversation links have lightweight activity markers and their actual phone/time metadata. No fabricated audit/activity events, unsupported calls or CRM fields. Customer data is still loaded through the same authorized contact read services.

## Deliberate comparison cycles

1. Production build/capture: both populated and empty/error/search/keyboard tests passed (**27.5s**). Compared the 1440 image with 02-Inbox and the prior reconstruction: two-line 65px rows, 64px primary / 130px combined header, patterned conversation and lighter eligibility already release useful space. Measured composer was 107px. The mobile capture exposed a truncated name and wrapping placeholder. Corrected those with a separate mobile action row, short writing placeholder, smaller desktop mode selector and practical mobile mode targets. Notes now put author/time before body.
2. Second production build/capture: both cases passed (**26.4s**). Rechecked 1440 against the concept and cycle one: composer becomes 101px, row/header geometry stays compact, customer-first context stays 121px for the WhatsApp section. Inspected mobile: full name, one-line writing, accessible 40px controls and sequential navigation. The final regression adds explicit mobile name/target/resting-writing assertions. All historical reference/reconstruction/cycle captures are retained independently. The final four-width screenshot inspection then exposed a still-truncated name in the narrower 1024px thread. A focused follow-up uses a header container query: actions move below identity when the thread itself is narrower than the built-in small container breakpoint, preserving the desktop single row and the 768px two-pane layout. The final fixture asserts a fully visible customer name at every requested width.

At thumbnail scale the communication-led list, active emerald selection, warmer textured thread, richer outgoing bubbles and private notes read distinctly. This remains an adaptation of the visual intent to real capabilities, not a claim of an exact visual match.

## Responsive and accessibility

1440 keeps the four-pane composition. At 1024 the rail remains 176px, list 264px, flexible thread and context drawer. At 768 supported views move into list controls beside the thread. At 375 only list or conversation is shown, with back navigation and customer-context drawer; full customer identity takes priority over keeping desktop actions on one line. Long lists/thread scroll within their panes. Expanded writing scrolls internally at its cap. The final fixture checks page horizontal and document-height overflow, all four widths' AA, expanded disclosure AA, mobile context AA/focus restoration and explicit writing/mode/tool target geometry. Final evidence and exact aggregate results follow below.

## Validation results

All final captures were inspected, including Home consistency, all four widths, note/expanded writing, expanded eligibility and mobile drawer/list. The focused narrow-thread correction now preserves the complete fixture customer name at every requested width.

- `pnpm lint && pnpm typecheck && pnpm test`: **pass** on the final source. Unit aggregate **299** (UI 53, web 15, API 130, contracts 40, config 16, WhatsApp 33, database 3, queue 5, worker 4). Changed UI/web suites executed during the pass; unchanged Turbo tasks reuse valid cache results. The last recheck executes the changed web suite and reuses unchanged UI/domain results. The existing Radix Tabs act warning is unchanged. Module boundaries and design enforcement pass.
- `pnpm --filter @fenwira/ui test`: **53 passed**, including the outbound contrast matrix and pinned new token. All actual outbound combinations clear AA; focus/status defaults are retained.
- `docker compose --profile test run --rm --no-deps fenwira-test sh -c 'pnpm --filter @fenwira/worker exec vitest run --config vitest.integration.config.mts test/inbox.int.test.ts'`: **10 passed (53.63s)**, without harness/domain changes. Coverage: collisions, 100-message burst ordering/unread/deduplication, server window rules, takeover, tenant WebSocket/search isolation, assignment/notification/round robin, snooze and canned-reply role/isolation rules.
- `EV2_LIGHTHOUSE=true pnpm --filter @fenwira/web exec playwright test inbox-reconstruction.spec.ts inbox.spec.ts experience-v2.spec.ts home-reconstruction.spec.ts responsive.spec.ts keyboard.spec.ts design-system.spec.ts smoke.spec.ts tenancy.spec.ts a11y.spec.ts campaigns.spec.ts`: **61 passed (3.7m), zero failures/skips** before the final narrow-thread presentation correction. Browser coverage includes Home/tenant regressions, keyboard/overlay/navigation, real sends/notes/canned replies/locks, window and disconnection states, pending drafts, offline recovery, empty/error/search states, AA and responsive overflow.
- After the screenshot-proven 1024 name correction, `EV2_LIGHTHOUSE=true pnpm --filter @fenwira/web exec playwright test inbox-reconstruction.spec.ts inbox.spec.ts experience-v2.spec.ts`: **13 passed (1.6m), zero failures/skips** on the final production source. This repeats all affected Inbox/ Home compatibility, reliability and accessibility cases, adds non-truncated identity assertions at every requested width and retains growth/cap/shrink, 40px mobile targets, disclosure keyboard and drawer focus checks. These are 13 rechecked cases within the prior 61, not 74 distinct tests. No assertions or tests were removed/weakened; existing disclosure tests now open the supported details before checking the complete unchanged verdicts.
- Final four-width populated Axe WCAG 2.2 AA and expanded details/drawer: **zero violations**, no page horizontal/document-height overflow. Authenticated Lighthouse **Home 100 / Inbox 100**, verified protected final URLs, no failing accessibility audits; sanitized [results](experience-v2/evidence/inbox-final-fidelity/accessibility.json) only.
- `docker compose build fenwira-web && docker compose up -d --no-deps --wait fenwira-web`: **pass** for both cycles and the final responsive correction. Every build has 51 routes and three uncached successful build tasks; task times **1m28.878s**, **50.148s**, final **44.584s**. Final web starts healthy. No backend rebuild/change.
- `pnpm smoke`: **pass again after the final build**: API/web readiness and persisted outbox → relay → queue → worker round trip. All eight local services healthy. `docker compose exec -T fenwira-api printenv BILLING_ENFORCED BILLING_SUBSCRIPTIONS_ENFORCED` confirms **false / false**.
- Formatting and whitespace are verified with `pnpm format:check` and `git diff --check` before the local commit. No raw Lighthouse payload/browser profile or root log file is added; retained evidence is sanitized JSON and review screenshots.

These are local existing-stack/isolated Inbox-suite results. No full database integration suite, clean-volume deployment or CI result is claimed.

## Domain/scope boundary

**Zero backend/domain changes.** No messaging, eligibility, consent, assignment/takeover, lifecycle, realtime, template, wallet, subscription, RBAC/RLS, schema, API/contract or rollout changes. No approved Home/shell or other-module source changes. Shared changes are restricted to the outbound-only token and its contrast contract. Local production verification does not claim CI, clean-volume deployment, full integration/closure or visual approval. **Ready for visual review. Stop here.**

## Evidence

[Reference, historical stages, two cycles and final captures](experience-v2/evidence/inbox-final-fidelity/README.md). Previous screenshot folders remain untouched.

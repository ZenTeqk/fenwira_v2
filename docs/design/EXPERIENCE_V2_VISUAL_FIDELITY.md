# Experience V2 — foundation visual-fidelity correction

Scope: App Shell, Home and Inbox only, on `phase-11` after Batch 2 checkpoint `1619fec`. The user's correction explicitly authorizes visual polish, not another redesign. Existing App Shell/Home/Inbox structure, routes, server contracts, page compositions, behavior and permissions remain authoritative. Batch 2 implementations are preserved; later module work and Phase 11 closure are outside scope. Stop for visual approval.

## Visual issues identified

Directly inspected [approved Home](experience-v2/01-Home.png), [approved Inbox](experience-v2/02-Inbox.png), and both previous 1440px implementation captures. The implementation overused one mint initials treatment, identical bare alert glyphs, neutral note surfaces and equally weighted white panels. Flat message metadata pills, weak thread/composer elevation and uniform font weights muted the reference's communication character. Sparse test data also made the old evidence less representative, so new evidence uses five real synthetic customer conversations persisted through existing APIs.

## Tokens changed

Three new central tokens in `packages/ui`, mirrored in the Tailwind theme and documented in Design System v1:

| Token | Value | Role |
| --- | --- | --- |
| `thread-soft` | `#F3F2ED` | Warm focused conversation canvas |
| `message-outbound` | `#DDF4E8` | Clearly perceptible emerald outgoing bubble |
| `note-soft` | `#FFF8EB` | Warm private-team note surface |

All existing foundation/status/avatar palette colors and elevations are reused. No global palette replacement. Small text retains accessible muted `#66716B`; screenshot decorative muted `#737C77` remains unsuitable for text. Contrast tests caught the initial thread tint below AA, and it was lightened. Muted text also failed on the stronger outbound tint; message metadata now uses secondary/strong status foregrounds. Tests cover actual new pairings, without reducing the threshold.

## Components refined

Shared Avatar gets opt-in `appearance="varied"`: stable soft emerald/blue/amber/red/green identity tones with accessible strong letters and names. Shared Timeline gets opt-in `appearance="activity"`: compact semantic icon surfaces and fine connecting lines. Shared StatusBadge gets opt-in inline label/tick metadata; its domain presets do not change. Other module avatars/timelines/badges retain their existing defaults.

Refined Home attention/activity, Inbox views/list/header/thread/composer/contact context, and shell account/nav/search treatment. Reused existing primitives, sizes, focus behavior, status presets and elevation tokens. No new fonts, dependencies, imagery or decoration.

## Home

Attention rows use compact message, wallet, workflow, campaign or template glyphs in restrained semantic circles, stronger object names, quieter supporting copy and emerald text actions. Conversations use larger deterministic human initials and clearer name/preview/time hierarchy. Campaign and automation activity retain actual states, update times, counts and existing links, with differentiated compact timeline icons. Card headers have fine dividers and a more deliberate internal rhythm. Attention/current activity, recent conversations, automation activity and secondary metrics keep their existing order/composition.

Home's existing campaign read model contains total recipients but no delivery/progress counts; its flow list has no graph. No progress percentage, invented graph nodes, historical timeline events, replies, sparklines or additional service queries are introduced to imitate the screenshot. Their richer visual framing does not fabricate data.

## Inbox

Views/filter chrome uses a light warm surface; the list stays white, with refined separators, larger varied identities and actual assignment avatars. Selected rows retain the established emerald state, unread typography/counts and real preview/status semantics. The focused thread uses a distinct warm canvas, white incoming messages and more perceptible emerald outgoing messages, subtle raised edges and smaller inline labelled delivery ticks. Private notes are explicitly labelled **Internal note**, with a compact note glyph and warm cream treatment.

The composer has a stronger boundary, tactile surface, existing raised shadow and a compact rounded Send affordance. Its existing Reply/Internal note modes, inputs and action order remain unchanged. Near-expiry header presentation uses the existing warning/clock preset while preserving the server-owned window and original label; eligibility is unchanged. Context has a stronger avatar/identity grouping, fine section boundaries and warm note cards. Tags honor stored user-selected tones; no fabricated colors or status logic. Desktop/mobile panel order and responsive drawer behavior are unchanged.

## Reference comparison

| Dimension | Home | Inbox |
| --- | --- | --- |
| Background | Same warm neutral foundation; white communication objects | Warm canvas, light view rail, white list/context and differentiated warm thread |
| Sidebar | Existing light structure and emerald selection; quieter inactive weights | Same shell; no new navigation or actions |
| Surface hierarchy | Fine header dividers and compact attention icon surfaces | Thread emphasis, distinct bubble/note/composer surfaces |
| Color richness | Purposeful semantic icons and varied human initials | Varied initials, stored tag tones, perceptible outgoing tint and cream notes |
| Typography | Semibold object identity; normal descriptions and smaller times | Unread/customer hierarchy, subdued previews and compact timestamps |
| Spacing/density | Existing layout with refined row/header rhythm | Existing panels with refined conversation rows, message padding and context sections |
| Icons/status | Specific attention objects and status-derived activity circles | Existing labelled window/delivery states, compact note and assignment identities |
| Borders/shadows | Fine dividers; no decorative elevated card wall | Subtle bubble/composer elevation; overlays keep existing menu/drawer shadows |
| Overall impression | Human communication activity on a calm white/warm foundation | Central conversation visually leads, with distinct customer, agent and private-team content |

Thumbnail review compares the approved images and new captures at approximately quarter scale: the foundation and panel distribution remain consistent, with purposeful blue/amber/emerald identity accents replacing repeated bare glyphs and mint initials. Existing data availability governs density; no pixel-identity claim or inferred visual approval. Brand assets, fonts, domain status mapping and accessible contrast take precedence over image-generation artifacts. No gradients, wallpaper illustrations, glassmorphism, heavy shadows or saturated tags.

## Accessibility and tests

- `pnpm lint`, `pnpm typecheck`, `pnpm test`: pass. **299 unit tests** — UI 53, web 15, API 130, contracts 40, config 16, WhatsApp 33, database 3, queue 5, worker 4. Two additional UI regressions cover stable opt-in identity treatment and labelled inline delivery metadata. Existing contrast tests cover the new surfaces. Unchanged Turbo tasks reuse cache; changed UI/web tests execute. Existing Radix Tabs `act(...)` warnings are not suppressed.
- Relevant real-service integration: **43 passed**, no skips — RLS **17**, Inbox **10**, messaging **16**. Database suite **2.88s**; two worker suites **139.19s**. All **20 existing migrations**, post-migrate security setup, RBAC/plan seed and RLS check pass. Tests use the already verified unchanged backend test image, separate `fenwira_ev2_fidelity_20261007` database and previously empty Redis DB **9**. Initial setup attempts revealed the local owner's database-create restriction and missing required extensions; the task's new disposable database was reinitialized following `01-roles.sh` before the passing run. No accepted database, wallet ledger or audit history is reset. Coverage includes actual sends/status ticks, media, retry/idempotency, window enforcement, collision locks, notes/lifecycle, unread ordering, WebSocket/tenant isolation and RLS.
- Dependency/design checks pass: **743 modules / 2576 dependencies**, zero violations; no raw feature colors or arbitrary values. `pnpm format:check` passes; `pnpm openapi:check` confirms the existing document is current. Backend/contracts/schema/dependency/Dockerfile diff is empty.
- Docker production web build passes: **51 routes**, three uncached successful tasks, **1m0.284s**. Final web container is healthy. Existing images/services and volumes remain in use; this does not claim a new clean-volume clone or remote CI run. The host build's previously reproduced Turbopack/PostCSS port-binding restriction is separate; no bundler/font setting is changed to hide it.
- `pnpm smoke` passes API readiness, web/sign-in and outbox → relay → queue → worker. Eight local services are healthy. API flags remain **`BILLING_ENFORCED=false` and `BILLING_SUBSCRIPTIONS_ENFORCED=false`**.
- Initial populated fidelity capture passes (**one browser case, 28.1s**) with zero WCAG 2.2 AA Axe violations and no global overflow at 1440/1024/768/375. It is not added to the unique aggregate count. Final authenticated Lighthouse 12.8.2 scores are **100 for Home and populated Inbox**, with protected final URLs verified ([sanitized scores](experience-v2/evidence/checkpoint-1-visual-fidelity/accessibility.json)). Full browser results are recorded below.

Final aggregate browser command: `EV2_LIGHTHOUSE=true EV2_BATCH2_LIGHTHOUSE=true pnpm --filter @fenwira/web exec playwright test`: **96 passed, one existing optional visual-capture case skipped, 10.7 minutes**. The new review case supplies all eight retained responsive captures, so the optional skip does not leave this correction without evidence. The full suite covers keyboard/navigation, read-only roles, 2FA/platform isolation, tenant switching/cache clearing, offline recovery, pending-send draft preservation, window/connection presentation, actual replies/notes, stored tags, existing template/campaign flows and the preserved Batch 2 compositions. Its five authenticated Batch 2 Lighthouse routes also remain **100**, alongside Home and Inbox. Existing tests only update the expected presentation label from “Internal” to the requested “Internal note”; no assertion is removed or weakened. No remote CI run is claimed.

Final checkpoint secret scan covers the committed history; no leaks found. Working tree is clean after the local correction commit.

## Screenshots

Approved references and the previous [foundation evidence](experience-v2/evidence/README.md) stay untouched. Eight new review screenshots are retained under [checkpoint-1-visual-fidelity](experience-v2/evidence/checkpoint-1-visual-fidelity/README.md), at 1440/1024/768/375, and all were visually inspected. Review fixtures use persisted API/mock inbound records, not fake production UI data. Raw logs, browser profiles and traces stay in ignored test results, with no root log files.

## Domain changes

**None.** No backend, contracts, migrations, authentication/RBAC/RLS, eligibility, messaging/realtime, wallet, subscriptions, campaigns, automation engine or analytics semantics change. No production enforcement flag is enabled. The near-expiry clock and internal-note label are presentation changes only. Existing sends/notes, offline recovery, draft protection, confirmations and tenant navigation remain covered by regression tests.

**Stop for visual approval after this correction.** No subsequent module implementation or Phase 11 closure.

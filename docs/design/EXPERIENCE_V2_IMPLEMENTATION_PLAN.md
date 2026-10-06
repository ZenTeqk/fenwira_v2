# Experience V2 implementation plan

Audit date: 2026-10-06. Baseline: `phase-11`, `1df9fa7`; tracked tree clean, eleven user-supplied references in `docs/design/experience-v2/`. Phase 11 Steps 1–3 CLOSED, Steps 4–5 ACCEPTED; overall closure remains blocked by the recorded fresh MinIO pull/CI issue. This UI task does not declare Phase 11 closure.

## Authority and scope

Existing domain/security behavior, the supplied Experience V2 master instruction, approved screenshots, compatible Design System v1 foundations, then implementation preference. Preserve subscriptions, entitlements, billing flags, RLS/RBAC and platform security. No API/schema/domain changes are needed for these first increments. No external design generation: the supplied direction is approved.

Deliver EV2-01 audit/foundation, EV2-02 shell, EV2-03 Home, EV2-04 Inbox in separate reviewable commits. **Stop after App Shell, Home and Inbox for visual review.** Subsequent modules remain planned, not accepted by this checkpoint.

## Repository architecture and current assessment

Next.js App Router uses `(app)/layout.tsx` → AuthGate/SessionProvider/AppShell. Switching workspace removes tenant query caches and remounts content. React Query keys include tenant IDs; Socket.IO supplies message/status/assignment/compose-lock events. Fetch adapters use existing CSRF and tenant headers. `/platform` has independent authentication, sessions and shell. No platform navigation belongs in the tenant shell.

Tailwind v4 consumes `packages/ui/src/styles/theme.css`; `tokens.ts` and its contrast tests pin the contract. Inter, Lucide, Radix wrappers, table/chart primitives, modal/drawer focus handling, shared state components and reduced motion already exist. Feature imports remain `@fenwira/ui`. No new dependency required.

The current shell is dark slate, 248px/64px, with topbar search, help, notifications, workspace switching, modules and module tabs. Keep that functional architecture, make its expanded sidebar 232px and light; retain the icon rail and drawer. Rename the Dashboard display label to Home while preserving `/dashboard`, IDs and redirects. Footer gains the real member identity/role and account actions. Workspace/footer wallet state remains server-owned and permission-filtered, including the existing NOT_ENFORCED behavior.

Dashboard already reads connections, workspace status, wallet, conversations, campaigns, rejected templates and analytics. Its four large metrics precede operational activity. Recompose attention first, recent conversation rows and campaign activity, then compact secondary metrics and automation activity. Use existing `/flows` summaries for real flow status; no fabricated execution timeline or cross-domain event feed.

Inbox currently has a 320px conversation list, virtualized thread and 340px contact pane (drawer below 1280). Shared hooks own realtime/cache behavior, compose locks, canned replies, templates, attachments, internal notes, assignment/status/takeover, unread and eligibility. Introduce desktop view rail and compact avatar-led rows; preserve all sending paths. At 1440 use 160px views, 280px list, flexible thread and 256px context; below 1280 context is a drawer; below 1024 views collapse into the list controls; below 768 list/thread are sequential with back navigation. The thread remains primary. Contact context is lightweight, never CRM.

## Reference → route/component/API map

All eleven images were visually inspected. Screenshot labels, values, people and numbers are illustrative; only authorized server data may populate production UI.

| Reference | Existing route and components | Existing data / migration |
| --- | --- | --- |
| 01 Home | `/dashboard`, `Dashboard`, `AppShell` | `/conversations`, `/campaigns`, `/flows`, `/analytics/overview`, `/workspace/status`, connections/templates; EV2-03 |
| 02 Inbox | `/inbox?c=…`, ConversationList/Header, Thread, Composer, ContactPane | conversations/messages/notes/presence/locks, contacts/eligibility, WS; EV2-04 |
| 03 Contacts | `/contacts`, `/contacts/:id`, tags/segments/imports, ContactPreview | contacts/consent/activity/eligibility; EV2-05 |
| 04 Templates | `/templates`, `/templates/new`, `/templates/:id`, template editor/preview | template lifecycle/version/sync endpoints; EV2-06 |
| 05 Campaign | **Image contents are the studio**, `/campaigns/new`, campaign wizard | existing audience/estimate/template/schedule/review; EV2-07 |
| 06 Campaign studio | **Image contents are the campaign list**, `/campaigns`, `/campaigns/:id`, `/campaigns/analytics` | campaign status/stats/recipients/pause/resume/cancel; EV2-07 |
| 07 Automation Studio | `/automations/:id`, `/automations/new`, history, flow builder | flows/draft/version/execution endpoints, existing React Flow + Outline; EV2-08 |
| 08 Analytics | `/analytics` and messaging/campaigns/inbox/automations/usage | existing aggregates/freshness/retention, TrendChart and table alternative; EV2-09 |
| 09 Integrations | `/integrations/whatsapp`, `/integrations/api`, `/integrations/webhooks/:id` | connections/keys/webhook endpoints; EV2-10 |
| 10 Billing | `/billing/subscription`, `/billing/wallet`, usage route | subscription/plans/ledger/customer charge/support config; EV2-10 |
| 11 Settings | `/settings/workspace`, team/roles/whatsapp/security/audit | existing workspace/member/permission/security APIs; EV2-10 |

Related child routes inherit shared tokens now; their compositions migrate with their module. Existing navigation phase/permission visibility is preserved rather than enabling unaccepted pages as a visual change.

## Reuse, refactor and safe deprecation

Reuse Button, Avatar, Card, SectionHeader/PageHeader, DashboardLayout, Skeleton, EmptyState/ErrorState/PermissionState, StatusBadge, Dialog/Drawer, command palette, Timeline, table/chart, session/realtime/hooks. Refactor central theme, shell/nav/status/switcher, DashboardLayout composition, Dashboard and Inbox panes. Add small Home activity components and a shared Inbox view choice component as needed, never another primitive library. `KpiCard` remains its documented compatibility alias. Do not delete `Segmented`, old page patterns or builders while still imported. No competing token theme; slate aliases remain primary-text compatibility names, not a second dark customer shell.

## Foundation and token migration

Warm canvas `#F7F7F4`, sidebar `#FAFAF8` / border `#E7E7E2`, white surfaces, subtle `#F5F5F1`, borders `#E5E7E3` / `#D6D9D4`, text `#18201D` / `#4B5550`. Primary `#00A884`, hover `#008F70`, strong text/fills `#007F64`, subtle `#EAF7F2`. WhatsApp `#25D366` stays distinct from success `#16A34A`; retain accessible status strong shades and meanings. Controls 8px, panels/cards 12px, overlays 16px. Keep existing 4px spacing/type scale.

The specified muted `#737C77` does not clear 4.5:1 on warm tinted surfaces. Use it as `muted-decorative`; use an explicitly documented darker muted text shade for small text. Likewise primary accent on warm canvas falls below 3:1: use primary-strong for focus outlines. Verify all pairings before changing components. This is required by the master's WCAG AA constraint, not a new visual direction. Shared token changes apply compatibly to platform primitives; no platform workflow changes.

## Increment plan and acceptance

1. **EV2-01:** record this audit, all reference mappings/gaps, design contract, central warm tokens/contrast tests and agent guidance. Acceptance: token tests/design lint pass; existing UI primitives remain usable.
2. **EV2-02:** light 232px shell, Home label with stable route, light mobile navigation, real account footer/status, contextual topbar/search. Acceptance: all previously visible routes reachable, roles remain filtered, workspace switch/logout/search/collapse work, 375/768/1024/1440 no overflow and keyboard/axe pass.
3. **EV2-03:** attention-first white panels, recent conversations with deep links, current campaigns, real flow activity, secondary compact seven-day metrics, real health/state fallback. Acceptance: real-data/empty/error/loading/permission states; no invented all-domain activity or today metrics; money hidden without billing.read; no giant KPI-first layout.
4. **EV2-04:** desktop view rail, avatar rows/assignment/status, balanced thread/context, composer toolbar responsive, internal notes distinct, message grouping from existing sender/time, mobile back/details sequence. Acceptance: real send/note/template/canned/assignment/status/takeover/lock/realtime preserved; near-expiry/expired/connection and error states; permissions, four widths, keyboard and axe pass.
5. **Checkpoint:** lint/format/typecheck/unit/integration/browser/build/dependency/design checks, screenshots of Home/Inbox at four widths, visual comparison and Lighthouse. Report actual results and limitations; STOP for review.

Later sequence: EV2-05 contacts; 06 templates; 07 campaigns/list and wizard; 08 automations; 09 all analytics; 10 integrations/billing/settings and children; 11 systematic responsive/non-happy state review; 12 complete regression/visual acceptance. No later composition work in this checkpoint.

## Capability gaps and deliberate deviations

- No tenant team queues, starred conversations, phone calls, AI replies or product/order cards. Retain individual assignment and real supported views, including takeover/resolved; Unread maps to the existing unread filter.
- Home has no unified event-feed API. Use clearly labelled current campaigns/flows and recent conversations, not fictional historical events or execution counts. Seven-day analytics stay labelled seven days; never relabel as Today.
- No third-party connected-app grid without actual connectors. Later Integrations shows existing WhatsApp/API/webhooks only.
- Billing screenshots' amounts, forecasts/recommended funding, prices and next-period dates are examples, not policy. Preserve configured support/manual funding, existing subscriptions/customer-charge APIs; no provider cost in tenant UI.
- Template usage counts and campaign reply metrics appear only if existing contracts actually support them. No fabricated audience exclusions or rates.
- Reference filenames 05/06 are reversed by content; source files remain untouched.
- Existing brand artwork remains authoritative; screenshot leaf artwork is not a request to replace the logo.

No critical data/security blocker for these first three UI increments. Unsupported decoration/actions are omitted under the master's no-fake-UI rule. A genuinely missing required critical state would stop implementation and be reported.

## Validation and risks

Extend existing navigation/token tests and Playwright responsive, smoke, keyboard, Inbox and accessibility suites. Add EV2 browser coverage for layout, view filtering, Home API failures/permissions, selected conversation mobile/context, composer lock/expiry, and screenshot evidence using the simulated Meta stack. Preserve server-side eligibility tests, RLS/security matrices, wallet/subscription/entitlement regressions; backend untouched. Use deterministic controlled responses for precise UI states, real local mock sends for behavioral regressions. Test widths 1440/1024/768/375 and local scrolling only for wide data.

Main risks: constrained Inbox thread at laptop width (hide optional rails/panels progressively); token changes can affect existing route/platform contrast (run shared tests and full axe regressions); failed disabled queries must not look perpetually loading (gate on permissions); inherited tests refer to Dashboard/248px (update only intentional presentation expectations). Production enforcement remains untouched. Existing clean-clone MinIO blocker is separate from cached-stack UI validation. Keep transient logs/screenshots in ignored test-results; do not recreate root log piles.

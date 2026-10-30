# Approved three-panel Inbox implementation — 30 October 2026

Implements the user's approved WhatsApp team inbox reference in the existing application.
The new palette applies only inside Inbox. The original application sidebar and topbar are
restored, including the 224px expanded / 64px collapsed sidebar, labels, colours, footer and
collapse control. Other module layouts keep their existing shell. List and customer context are 320px each at 1440px, with a flexible thread.
The 56px application header, 72px conversation header and independently scrolling panels
keep the composer visible. Customer details can be collapsed and reopened. Below 1280px desktop details start collapsed
and reopen docked beside the chat; below 1024px they use the existing accessible drawer. Mobile keeps separate list/chat/details views.

## Rendered review

These screenshots were captured from the running development frontend at `http://localhost:3100`
and the final rebuilt application at `http://localhost:3000`, and visually inspected. Browser-only fixtures supply the reference scenario; screenshot names,
messages and counts are not embedded in production components or persisted to a workspace.

- [1440px desktop](inbox-1440.png)
- [1440px internal-note mode](inbox-note-1440.png)
- [1280px](inbox-1280.png)
- [1024px](inbox-1024.png)
- [1024px with details docked](inbox-docked-1024.png)
- [768px tablet](inbox-768.png)
- [375px mobile](inbox-375.png)

## Behavior and verification

The existing API contracts, React Query caches, tenant keys, permission gates, realtime rooms,
authorized send/note paths, idempotency headers, drafts, compose locks, service-window checks,
template picker, canned replies, media downloads and receipts remain in use.

`inbox-approved-reference.spec.ts` verifies desktop column dimensions; composer visibility at
1440/1024/768/375px; no horizontal page overflow; IME Enter handling; sending; note mode;
customer-panel close/reopen with draft retention; real Files/Activity presentation; closed reply
windows; long names and filenames; missing fields and phone fallback; failed messages/uploads;
empty/error/search states; and preserving the visible message when older history loads.
Axe WCAG A/AA checks pass on the populated responsive views, note mode, drawer, closed-window
state and long-content state. Message-type filters are hidden initially and remain available
through the header and its overflow menu.

Repository lint (including dependency boundaries and semantic token checks), type checking,
and the unit suite pass. The unit suite needs local socket access for its mock HTTP servers.
The supplied secondary grey is retained on white surfaces; outgoing metadata and neutral count
chips use main text because that grey does not meet AA contrast on their tinted backgrounds.

Unsupported screenshot-only capabilities (pinning, teams, emoji and starting conversations) are
omitted. Contact notes remain separate from conversation internal notes. Consent displays only
recorded server values. Activity uses existing conversation history. The existing immediate
attachment-upload/send behavior is retained. No backend, schema or messaging-policy changes.

## Final regression results

- `pnpm lint`, `pnpm typecheck`, `pnpm lint:design` and formatting checks pass.
- `pnpm test` passes: 560 unit tests across the workspace.
- The 11 existing inbox scenarios pass across the combined run and focused reruns: real
  inbound/realtime replies, two-agent compose locks, draft persistence, internal notes,
  resolution, canned replies, contact tag/note writes, media downloads, live receipt updates,
  template rendering, message filters, responsive geometry and customer-panel behavior.
- Two message-loading scenarios timed out during the first combined run and passed on their
  isolated rerun. The rich template scenario exposed low-contrast labels/footers; after the
  inbox-only correction it passes Axe and its functional checks.
- The three new browser scenarios pass, including expanded eligibility with recorded `NONE`
  consent, docked details at 1024px, and populated Axe checks at 1280px as well as the four
  required widths. Desktop details never cover or dim the chat.
- The production web image builds successfully; only the local web service is refreshed.
  Existing API/worker/database services and backend contracts are unchanged.

## Navigation correction

The user requested the original left application panel after reviewing the redesign. Shell
and SidebarNav source are restored to their original versions; the inbox theme is scoped
inside InboxLayout and the portalled customer drawer. The inbox redesign is retained.

## Readable filters and 12-hour clocks

The user's final preference keeps compact message-type controls on one horizontal line.
Separate left/right arrows appear only when the row overflows, with disabled states at its ends.
The native scrollbar is hidden, so it cannot cover labels; trackpad, touch and keyboard scrolling
remain native. Arrows sit outside the scrolling area. Resize and count changes update their
availability. Browser checks cover arrows, horizontal-wheel gestures, keyboard focus, reduced
motion, ordinary smooth scrolling, filter hide/reopen and page containment at 1440, 1280, 1024,
768 and 375px. The earlier wrapping approach is superseded.

[1280px start](filter-arrows-start-1280.png) · [1280px end](filter-arrows-end-1280.png) ·
[375px start](filter-arrows-start-375.png) · [375px end](filter-arrows-end-375.png).

Inbox message clocks explicitly use AM/PM while keeping the browser's time zone. Incoming,
outgoing and current-day list timestamps are verified in an en-GB browser, whose default clock
normally uses 24-hour time. Six unit cases cover midnight, morning, noon, afternoon, late night
and the current-day/older-date list behavior. Web lint, type checking and token checks pass.


## Compact conversation-list controls

All/Mine/Unassigned now use contained grid cells, with extra space for the longer Unassigned
label. Their desktop height is 32px (36px on phones), with 12px labels and compact count chips.
The status, unread and advanced-filter controls align at 28px on desktop and 32px on phones;
the row uses 6px vertical padding. Active/hover styling stays within each button. Counts retain
their full server values and accessible labels. Inactive count chips use main text for AA contrast.

A focused browser check uses the screenshot's 80/0/80 counts across 1440, 1024, 768 and 375px.
It checks button/label/badge bounds, row heights, absence of overlap and page overflow, selected
and hovered states, Axe, and status/unread/advanced-filter actions.
[320px list](compact-list-filters-1440.png) · [280px list](compact-list-filters-768.png).

## Final icon and menu refinement

The redundant All/Mine/Unassigned dropdown is removed; the three visible tabs remain the view
selector. Its unique agent-takeover filter is retained as a compact text toggle next to status
and unread. The status label fits at the narrow list width. Existing server queries/count
semantics are retained.

The center and customer panels opt into a smaller icon scale: 14px action icons, 12px metadata,
18–20px file icons and 24px media play marks. Document-icon containers are 32px. Desktop
icon-only controls use 32px targets; mobile target sizes are preserved. The customer drawer
uses the same scale, and the application sidebar retains its original presentation.

Browser checks verify the menu removal, tab/status/unread/takeover operation, actual icon
sizes, desktop/mobile customer details, overflow actions, Axe and responsive containment.
[Desktop refinement](inbox-refined-icons-1440.png) · [Mobile details](inbox-refined-icons-drawer-375.png).

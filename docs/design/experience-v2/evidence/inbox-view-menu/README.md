# Inbox view menu — compact layout

User-directed refinement on 2026-10-07: remove the separate Inbox views column and put its controls beside **All conversations**. The six supported views remain All/Mine/Unassigned/Unread/Takeover/Resolved, using the existing server queries. Search, status/unread filters and messaging permissions remain authoritative.

The menu is nonmodal, has an accessible trigger name identifying the current view, marks the selected item with a check and `aria-current`, supports keyboard opening/selection and restores trigger focus on Escape. The initial open-menu accessibility check exposed hidden background focus targets from the default modal dropdown; setting this specific menu to nonmodal fixes that behavior without changing shared dropdown defaults.

At 1440px the conversation list stays **320px** and customer context stays **256px**. Removing the 176px rail plus its 8px gutter gives the thread **184px** more width: **424px → 608px**. The approved Home sidebar/topbar remain **224px / 56px**. At 1024px the list stays 264px; at 768px it stays 280px. Mobile keeps sequential list/thread navigation and gains space by replacing the previous view controls with the same heading menu.

| Review | Capture |
| --- | --- |
| Desktop composition | [1440px Inbox](inbox-1440.png) |
| Six-view menu | [Open menu](inbox-views-menu-1440.png) |
| Narrow desktop | [1024px Inbox](inbox-1024.png) |
| Tablet | [768px Inbox](inbox-768.png) |
| Mobile thread | [375px Inbox](inbox-375.png) |
| Mobile list and menu trigger | [375px list](inbox-list-375.png) |
| Home consistency | [Home](home-consistency-1440.png) |

Captures use synthetic browser-test fixtures persisted through existing APIs, not hard-coded application content. Previous [final-fidelity captures](../inbox-final-fidelity/README.md) remain unchanged for comparison. [Inbox geometry](inbox-geometry-1440.json) and [Home geometry](home-geometry-1440.json) record the measured layout.

Final validation against the rebuilt local production application:

- Web lint/typecheck, design-token check, repository formatting and dependency boundaries pass (746 modules / 2,584 dependencies).
- Web unit tests: **15 passed** (4 files, 1.22s).
- Affected Inbox/Home browser suite: **13 passed, zero failures/skips** (1.7m), including four-width WCAG 2.2 AA and no overflow, open-menu accessibility, six choices/current selection, keyboard opening/Escape focus, existing unread query, composer growth, permissions, draft retention and realtime messaging. The first run had 12 passes and the open-menu failure described above; the final run verifies the fix.
- [Sanitized Lighthouse scores](accessibility.json): **Home 100 / Inbox 100**, protected final URLs verified, no failing accessibility audits.
- Final production web build: **3 successful uncached tasks**, 51 pages generated, 1m37.941s; local web container healthy.
- Local smoke: API ready, web healthy/sign-in rendering, API → outbox → relay → queue → worker round trip passed.

All seven retained screenshots were visually inspected. Only Inbox presentation, its affected browser tests and design documentation changed; no backend or domain implementation changed. No additional integration run was needed for this layout refinement.

Ready for visual review. No later-module propagation or billing rollout changes.

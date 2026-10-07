# Inbox customer-details arrow

User-authorized refinement on 2026-10-07: the chat header's right-pointing chevron hides the desktop customer-details panel, and the left-pointing chevron restores it. Labels/tooltips say **Hide customer details / Show customer details**, with expanded state and controlled-region IDs exposed to assistive technology. The panel remains open by default for each selected conversation.

At 1440px the thread grows from **608px to 872px** when collapsed, reclaiming the 256px panel plus its 8px gutter. Keyboard toggling keeps focus on the arrow and preserves the existing reply draft. Below 1280px, the arrow opens the existing details drawer; Escape returns focus. Growing the viewport while the drawer is open closes it cleanly and restores the inline panel, with no stale modal overlay when shrinking again.

| State | Screenshot |
| --- | --- |
| Desktop panel visible | [1440px](inbox-1440.png) |
| Desktop panel hidden, draft retained | [1440px collapsed](inbox-contact-hidden-1440.png) |
| Narrow desktop, drawer trigger | [1024px](inbox-1024.png) |
| Tablet | [768px](inbox-768.png) |
| Mobile | [375px](inbox-375.png) |

All five captures were visually inspected. Records are synthetic test fixtures written through the existing APIs, not application placeholders. Earlier [view-menu evidence](../inbox-view-menu/README.md) remains unchanged. Home, shared primitives, customer data/permissions and backend domain services are unchanged.

Validation: web lint/typecheck, semantic-token and dependency-boundary checks pass; 15 web unit tests pass (4 files, 1.36s). Affected browser suite: **13 passed, zero failures/skips** (1.7m). Checks cover four-width WCAG 2.2 AA, desktop hide/show and measured width, keyboard focus, draft retention, responsive drawer handoff, mobile Escape focus, permissions and existing messaging regressions. [Sanitized Lighthouse scores](accessibility.json): Home **100**, Inbox **100**, no failed accessibility audits and protected final URLs verified. Production web build generates 51 pages with 3 successful uncached tasks; local API/web/outbox smoke checks pass. Repository formatting and diff checks pass.

Ready for visual review; no later-module propagation.

# App Shell / Home / Inbox visual checkpoint

Captured 2026-10-06 against the production `fenwira/web:local` image and local mock Meta services. Records shown are synthetic browser-test fixtures persisted through the existing APIs; none are embedded in application code. Original approved references remain in the parent directory.

All eight images were visually inspected. This is composition review evidence, not a claim of pixel identity: real records, permissions, status labels and preserved product behavior determine visible content.

| Width | Home | Inbox | Review |
| --- | --- | --- | --- |
| 1440 | [Home](home-1440.png) | [Inbox](inbox-1440.png) | Light 232px navigation, warm canvas and white surfaces. Attention precedes activity and compact metrics. Inbox views/list/thread/context have distinct boundaries. |
| 1024 | [Home](home-1024.png) | [Inbox](inbox-1024.png) | Home stacks operational sections. Inbox keeps views/list/thread; optional contact context moves to a drawer. |
| 768 | [Home](home-768.png) | [Inbox](inbox-768.png) | Navigation moves to its light drawer. Inbox views move into list controls; thread remains beside the list. |
| 375 | [Home](home-375.png) | [Inbox](inbox-375.png) | Home sections stack without overflow. Inbox becomes a sequential list/thread flow with back navigation and details drawer; customer identity and real actions remain readable. |

Reference comparison: [01 Home](../01-Home.png) and [02 Inbox](../02-Inbox.png). All eleven references were inspected during the repository audit; later module compositions await the required visual review before implementation.

Supported differences: preserved Fenwira brand, actual personal assignment/takeover/resolved views, existing seven-day analytics and billing state. Current campaign/flow state replaces an unsupported unified event feed. No invented screenshot numbers, teams, calls, AI, CRM cards or commercial policies. Accessible muted text and focus contrast are documented in the design contract.

Four-width WCAG 2.2 AA axe checks and no-page-overflow assertions pass. [Sanitized Lighthouse results](accessibility.json): Home **100**, populated Inbox **100**, protected final URLs verified. No cookies, tokens, browser profiles or raw Lighthouse payloads are retained here.

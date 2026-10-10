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

## Approved foundation and subsequent Batch 2

The user subsequently approved the foundation and authorized Contacts/Templates/Campaigns/Studio. Their separate [24 responsive implementation captures](batch-2/README.md) preserve these original foundation captures and all approved references. Batch 2 has its own visual/product review checkpoint.

## Foundation visual-fidelity correction

These original implementation captures remain unchanged as before evidence. The focused correction retains separate [Home/Inbox review captures](checkpoint-1-visual-fidelity/README.md), with comparison links to the approved images and original implementation. See the [correction report](../../EXPERIENCE_V2_VISUAL_FIDELITY.md). Visual approval remains pending.

Historical checkpoint: [Home reconstruction](home-reconstruction/README.md). The user has now approved that Home direction. This does not approve the other modules or authorize propagation.

Latest checkpoint: [Home scale and density refinement](home-density/README.md). It preserves the approved composition and palette, tightens Home and its visible shell, retains every historical capture and stops for a separate visual review.

The user subsequently approved that final Home density; it is now the canonical global language. The current [Inbox reconstruction](inbox-reconstruction/README.md) follows the Inbox reference composition and approved Home scale, preserving Home and all historical captures. Inbox has its own visual review checkpoint; later modules remain outside scope.

## Latest Inbox review checkpoint

The reconstruction is not visually approved. The [final fidelity pass](inbox-final-fidelity/README.md) retains all previous stages and corrects row/header/composer density, message character and customer-context hierarchy. Home and its shell stay unchanged. Ready for visual review; no later-module propagation.

The user then requested removal of the separate Inbox view column. The [compact view-menu checkpoint](inbox-view-menu/README.md) moves all six existing views into an icon menu beside the list heading and gives the freed space to the thread. It supersedes the rail composition while retaining the approved Home shell and all previous evidence.

The subsequent [customer-details arrow checkpoint](inbox-contact-toggle/README.md) lets the operator collapse/reopen the desktop panel for more chat space while preserving the smaller-screen drawer, drafts and keyboard focus.

## Contacts reconstruction checkpoint

The user approved the final Home and Inbox implementations and requested Contacts against `03-Contacts.png`. The [Contacts reconstruction evidence](contacts-reconstruction/README.md) retains before/first-pass/final captures, four-width checks and Home/Inbox consistency evidence. This checkpoint covers Contacts only and stops for visual review; it does not authorize later-module propagation.

## Templates reconstruction checkpoint

Home, Inbox and Contacts are now visually approved. The [Templates checkpoint](templates-reconstruction/README.md) follows the approved `04-Templates.png` composition and retains separate before/first-pass/final captures. It covers Templates only and stops for visual review before Campaigns.

## Campaigns and Studio reconstruction checkpoint

Templates and its mobile recipient preview are now visually approved. The next [Campaigns and Studio checkpoint](campaigns-reconstruction/README.md) retains before/first-pass/final captures and validates operations, Personalize and Review separately at four widths. Ready for visual review; stop before Automations.

## Campaigns populated fidelity correction

The latest [Campaigns populated fidelity review](campaigns-final-fidelity/README.md) responds to the user's reference comparison and ten-additional-demo request. It retains the prior checkpoint, adds original uploaded template sample artwork, real demo results, five-row history pages and four-width captures, with a side-by-side reference comparison. Ready for visual review; Create Campaign and earlier approved screens stay unchanged.

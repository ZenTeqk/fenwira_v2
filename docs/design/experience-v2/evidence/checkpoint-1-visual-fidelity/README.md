# Foundation visual-fidelity review

Focused App Shell/Home/Inbox styling correction. Original approved references and earlier implementation screenshots remain untouched.

| Screen | Approved reference | Previous implementation | Corrected desktop |
| --- | --- | --- | --- |
| Home | [Reference](../../01-Home.png) | [Before](../home-1440.png) | [After](home-1440.png) |
| Inbox | [Reference](../../02-Inbox.png) | [Before](../inbox-1440.png) | [After](inbox-1440.png) |

| Width | Home / shell | Inbox |
| --- | --- | --- |
| 1440 | [Home](home-1440.png) | [Inbox](inbox-1440.png) |
| 1024 | [Home](home-1024.png) | [Inbox](inbox-1024.png) |
| 768 | [Home](home-768.png) | [Inbox](inbox-768.png) |
| 375 | [Home](home-375.png) | [Inbox](inbox-375.png) |

Captured against the final production Docker web image, using five synthetic customer conversations created through actual inbound mock webhooks/domain APIs. Names, assignment, unread counts, tags, replies and private notes are real persisted fixture state. No screenshot-specific production data or mocked UI counts. Draft campaign/automation records remain explicitly Draft, with no invented progress or graph. Reference unsupported photography, product objects, billing states, activity events and figures are not added.

The original before captures use a smaller workspace, so their data density differs. Compare styling, visual hierarchy and color distribution rather than treating the data difference as a product capability or pixel-identical comparison. Home keeps its existing composition. Inbox retains the desktop panel structure and sequential mobile thread/context behavior. Controlled identity tones, semantic attention icons, warmer thread, clearer outgoing bubbles and cream notes supply purposeful color on the same calm neutral foundation. Shared defaults keep other modules intact.

[Correction report](../../../EXPERIENCE_V2_VISUAL_FIDELITY.md) records tokens, components, explicit reference comparison, domain boundaries and validation. Only review screenshots and sanitized accessibility scores belong here; no logs, browser profiles, cookies or raw Lighthouse audit payloads.

**Visual approval remains pending. Stop after App Shell/Home/Inbox.**

Final captures: **2026-10-07**, at 1440/1024/768/375, all eight visually inspected against the original references. No global overflow and zero scoped Axe WCAG 2.2 AA violations. [Authenticated Lighthouse accessibility](accessibility.json): Home **100**, populated Inbox **100**, protected final URLs verified.

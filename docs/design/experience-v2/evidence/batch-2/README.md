# Experience V2 — Batch 2 visual review

Implementation evidence for EV2-05 Contacts, EV2-06 Templates, EV2-07A Campaigns and EV2-07B Campaign Studio. Captured against the production web image and local mock services, using synthetic fixtures persisted through existing APIs. Original approved references remain unchanged in the ancestor directory. The Campaign reference filenames are reversed: 06 shows the list, 05 shows Studio.

| Width | Contacts | Context | Templates | Preview | Campaigns | Studio |
| --- | --- | --- | --- | --- | --- | --- |
| 1440 | [List](contacts-1440.png) | [Drawer](contact-context-1440.png) | [Library](templates-1440.png) | [Drawer](template-context-1440.png) | [Operations](campaigns-1440.png) | [Review](campaign-studio-1440.png) |
| 1024 | [List](contacts-1024.png) | [Drawer](contact-context-1024.png) | [Library](templates-1024.png) | [Drawer](template-context-1024.png) | [Operations](campaigns-1024.png) | [Review](campaign-studio-1024.png) |
| 768 | [List](contacts-768.png) | [Drawer](contact-context-768.png) | [Library](templates-768.png) | [Drawer](template-context-768.png) | [Operations](campaigns-768.png) | [Review](campaign-studio-768.png) |
| 375 | [List](contacts-375.png) | [Drawer](contact-context-375.png) | [Library](templates-375.png) | [Drawer](template-context-375.png) | [Operations](campaigns-375.png) | [Review](campaign-studio-375.png) |

All 24 captures were visually inspected. Desktop follows the approved light shell/warm canvas/white surface hierarchy: people-led contact rows, first-class message previews, stronger active campaign objects and paired Studio configuration/preview. Narrow screens stack cards and Studio regions; context becomes an overlay and wide tables scroll locally. No global overflow. Real API data, timezone, permission state and accessible text tokens determine visible content, so this evidence does not claim pixel identity.

Studio captures show the saved server estimate for the selected Farah recipient, including actual customer charge. They do not claim fictional client personalization or provider-cost data. Contact assignment and campaign audience summaries reflect supported metadata rather than screenshot-invented people or names. Template full-page evidence intentionally captures all stored content; preview drawers use viewport captures.

The [Batch 2 checkpoint report](../../../EXPERIENCE_V2_BATCH_2.md) contains commit history, domain boundaries, state/retry coverage, validation and deliberate deviations. Only sanitized accessibility scores are retained; cookies, profiles, raw audit responses, videos and transient logs stay outside documentation.

**Stop for visual/product review.** Later Experience V2 modules and Phase 11 closure are not part of this checkpoint.

Final captures: **2026-10-07**, 1440/1024/768/375. Zero Axe WCAG 2.2 AA violations and no global overflow across the four primary compositions and contextual drawers. [Authenticated Lighthouse accessibility](accessibility.json): Contacts, Templates, Campaigns, new Studio and saved-draft Studio all score **100**; protected final URLs verified. [Foundation regression scores](foundation-accessibility.json): Home and populated Inbox remain **100**.

[Sanitized production image scans](image-security.json) record zero fixable HIGH/CRITICAL findings and detected secrets, with content-addressed image hashes. [Pre-patch scan evidence](image-security-before.json) documents the reproduced Perl update. No raw secret-scanner payloads or caches are retained.

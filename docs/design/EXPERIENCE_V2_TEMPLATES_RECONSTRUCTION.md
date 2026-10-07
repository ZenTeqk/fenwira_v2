# Templates reconstruction — reference decomposition

Scope: Templates only. Home, Inbox and Contacts are visually approved and define the canonical production language. Use `experience-v2/04-Templates.png` for composition, then stop for Templates visual review.

## Before implementation

| Area | Current production | Reference-led correction |
| --- | --- | --- |
| Shell | Templates uses the older shell variant and topbar breadcrumb | Opt only the Templates library into the approved 224px navigation/56px topbar; approved screens remain unchanged |
| Header | Reusable-message subtitle, New template/Sync from Meta | Reference title/purpose and Create template/Sync with WhatsApp labels; retain APIs/permissions |
| Navigation/filters | Status tabs and detached large controls | Compact status navigation above one white library surface; search/category/language supported filters |
| Library | Spacious generic cards with large type/preview and separate footer action | Compact message objects: name, semantic category/language/status, actual message, quiet update/preview action |
| Selection | Overlay drawer at all widths | Inline desktop context at 1280px+, drawer below; retain selected card state and keyboard closure/focus return |
| Context | Message first with scattered metadata and sending links below | Identity/status/actions → real details → WhatsApp message → stored variable samples and lifecycle explanations |

## Product differences from the concept

Names remain actual Meta identifiers; there is no invented display-name field. Available fields include category, language, quality, current version, timestamps and account. There is no template-specific last-sync timestamp, campaign-use counter or variable semantic label, so none will be fabricated. Tab counts describe the current server-filtered library, not invented global totals. Status filters map to existing states, including ARCHIVED; Needs attention includes rejected/paused/disabled and drafts with submission errors. Approved availability comes from the existing approved-version endpoint, which can legitimately serve a previous approved version while the current version is under review. No sending is enabled by current status alone.

Edit/new-version, submit/retry and delete continue through the existing full template lifecycle page. Use in campaign opens the existing version-aware campaign entry link; Open Inbox opens existing conversations. No new messaging path, backend state, prices, domain logic or API contract. Samples are stored examples, not assumed customer identities or semantic variable mappings. Category/status treatments use existing shared semantic primitives.

## Validation and iteration

Capture current production before changes, then first/final reconstruction at 1440 × 1000. Validate 1024/768/375, centralized approved-version availability, read-only permissions, keyboard/focus handoff, empty/error/filter states and existing create/submit/retry/version/send flows. Retain screenshots and sanitized accessibility/geometry results under `experience-v2/evidence/templates-reconstruction/`; do not overwrite prior evidence.

## Implemented composition and corrections

The first populated capture established the three-column library and 320px desktop context. Comparing the thumbnail/major surfaces with the reference and approved foundation exposed an overly tall vertical action stack. The corrected panel puts available campaign, full-record and Inbox actions together ahead of details and preview. The first mobile run reproduced 9px of header-action overflow; a Templates-only header constraint lets the existing shared action container wrap rather than changing the shared PageHeader or approved screens. Status tab counts now use the current queried dataset; in-review presentation uses the existing warning text token while retaining the actual PENDING state and clock icon.

The library uses 12px padding/gaps, compact 14px messages, semantic category/language/status and quiet footer metadata. Actual longer messages determine row height; the compact card text is truncated, while selected context retains the full message. The existing preview renderer and media URL service are reused through a library-only opt-in; no approved builder, campaign or Inbox preview presentation was changed. The selected card receives a restrained emerald border/tint. Below 1280px the inline context becomes the existing shared drawer; mobile has one-column message objects with practical Preview targets. Keyboard Escape restores the preview control, including desktop-to-mobile handoff.

Full template lifecycle pages retain editing/new-version, submit/retry, immutable versions, rejection reasons, review, delete confirmation and send behavior. The new status filter uses an already-supported request field. Approved sending availability and failures use the existing approved-version query, with explicit retry on failure. No backend/domain, contracts, migrations, configuration or platform changes. No later checkpoint implementation.

## Verification

Concrete final results, screenshots, geometry and exact commands are recorded in the [Templates review evidence](experience-v2/evidence/templates-reconstruction/README.md). The before and first-pass captures are retained separately. The canonical Home/Inbox/Contacts regression and comparison captures are part of this checkpoint. Ready for visual review; user approval is required before Campaigns.

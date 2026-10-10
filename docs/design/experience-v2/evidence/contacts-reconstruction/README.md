# Contacts reconstruction — visual review checkpoint

Captured 2026-10-07 against the production local web image. Contacts only; Home and Inbox are visually approved and remain unchanged. Compare with the [Contacts reference](../../03-Contacts.png) and the [decomposition/change report](../../../EXPERIENCE_V2_CONTACTS_RECONSTRUCTION.md).

All records are synthetic browser fixtures persisted through existing APIs, including inbound messaging through mock Meta. No names, photos, event histories or commercial values are embedded in application code. No cookies, tokens, raw Lighthouse reports, browser profiles or verbose logs are retained here.

## Review captures

| Width | Directory | Selected contact | Treatment |
| --- | --- | --- | --- |
| 1440 | [Directory](contacts-1440.png) | [Compact desktop panel](contacts-context-1440.png) | Approved 224px navigation/56px header; heading, contextual tabs and compact toolbar precede the directory; inline 288px contact panel |
| 1024 | [Directory](contacts-1024.png) | [Contact drawer](contacts-context-1024.png) | Secondary tags/assignment columns collapse; existing drawer provides full contact context |
| 768 | [Directory](contacts-768.png) | [Contact drawer](contacts-context-768.png) | Navigation becomes a drawer; identity, phone and service/marketing state remain readable |
| 375 | [Mobile cards](contacts-375.png) | [Contact drawer](contacts-context-375.png) | Cards replace the desktop table; visible name/phone and practical identity/selection/action targets; no page overflow |

[Expanded eligibility/consent](contacts-eligibility-1440.png) retains the centralized server explanation. [Measured geometry](contacts-geometry-1440.json): ordinary rows **57px**, selected three-tag row **61px**, avatars **36px**, contact panel **288px**. Wrapping actual content is allowed.

Compare the [before directory](before/contacts-1440.png) and [before overlay](before/contact-context-1440.png), then [first desktop pass](first-pass/contacts-1440.png), [first context pass](first-pass/contacts-context-compact-1440.png) and [first mobile pass](first-pass/contacts-375.png). The final pass corrects filter wrapping, tag overflow, context hierarchy, mobile accessible names, responsive focus return and timeline connectors.

Home/Inbox consistency captures: [Home](home-consistency-1440.png), [Inbox](inbox-consistency-1440.png), [Home geometry](home-geometry-1440.json), [Inbox geometry](inbox-geometry-1440.json). Contacts uses the same heading, controls, surfaces and avatar language; it does not restyle either approved screen.

## Supported product differences

The reference's photos, blanket Eligible label, last-conversation timestamp, unsupported location and bulk assignment are not synthesized. Contacts uses deterministic varied initials, actual phone/email/language/country, `lastInboundAt` labeled Last incoming, real contact ownership and service/marketing verdicts from the existing eligibility endpoint. Stored tag colors are preserved. Message opens an existing Inbox conversation when authorized. Full profile retains complete history; the compact panel shows the three latest actual activities.

Import/Add contact lead. Export filtered contacts stays under Columns and preserves whole-filter scope. Tag/assignment shortcuts and More filters use the same existing DSL; no eligibility-filter backend or CRM capabilities were added. Existing creation/editing, consent notes, import processing, permissions and tag/untag/delete semantics are retained.

## Validation

- Web lint/typecheck, semantic design tokens and dependency boundaries pass (**749 modules, 2600 dependencies**).
- Web unit tests: **15 passed across 4 files**, 1.48s.
- Contacts browser suite: **8 passed, zero failures/skips**, 1.0m. Covers four-width geometry/no-overflow/WCAG 2.2 AA, keyboard selection/close, More-menu Escape, responsive focus return, editing, real tag/assignment filters, bulk untag, columns, search empty state, read-only permissions, centralized eligibility/error retry, existing consent/segment/CSV-import workflows and explicit Lighthouse audit. [Sanitized Contacts Lighthouse score](accessibility.json): **100**, protected final URL verified, no failed accessibility audits.
- Home/Inbox browser regression: **13 passed, zero failures/skips**, 1.8m. Existing messaging, responsive behavior, permissions and draft/focus checks pass. [Sanitized Home/Inbox Lighthouse scores](home-inbox-accessibility.json): **100/100**, protected final URLs verified, no failed accessibility audits.
- Final production web build: **3 successful uncached tasks**, **51 pages generated**; local web container healthy. API/web/outbox smoke checks pass.

No backend, database, contract or API authorization changes were made; backend integration suites were not rerun for this presentation-only checkpoint. Failed intermediate runs and corrections are described in the change report. Sandbox-only browser/Docker/network failures were rerun with authorized local-stack access.

Engineering validation does not grant visual approval. Stop here for Contacts visual review. Templates and Campaigns are outside this task.

Final Contacts command: `EV2_CONTACTS_LIGHTHOUSE=true pnpm --filter @fenwira/web exec playwright test contacts-reconstruction.spec.ts contacts.spec.ts experience-v2-batch-2.spec.ts --grep 'Contacts|contact|filter the contact|import a CSV'`. A subsequent capture-only correction restricts responsive fixed-drawer screenshots to the viewport; the populated four-width case passes again (**1 passed**, 17.5s). Directory screenshots retain full-page content. All final directory/context captures were visually inspected, including comparison with the approved Home/Inbox scale. The final connector is a thin line, not a resized block.

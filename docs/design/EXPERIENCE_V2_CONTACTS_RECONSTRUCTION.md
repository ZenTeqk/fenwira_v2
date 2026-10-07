# Contacts reconstruction — reference decomposition

Scope: Contacts only. The user approved Home and Inbox as the canonical Experience V2 implementations and supplied `experience-v2/03-Contacts.png` for Contacts composition. Stop after Contacts for visual review.

## Before implementation

Current production Contacts was captured through its existing browser fixtures before source changes. The reference is a coherent working directory with header/actions, contextual navigation, compact filters and a selected-contact side panel; current Contacts is a generic table followed by a full-height modal drawer.

| Area | Current implementation | Required correction |
| --- | --- | --- |
| Shell | Older 232px sidebar variant, extra topbar breadcrumb | Reuse the existing approved 224px shell variant for Contacts only; no Home/Inbox styling changes |
| Header/navigation | Context tabs above the page heading; separate count band; Export competes with primary actions | Heading → compact contextual links → one directory surface; Import/Add contact lead |
| Filters | Detached toolbar with one expanded filter form | Integrated search, quick stored-tag/assignment filters, existing advanced filter builder and column controls |
| Directory | Generic table; 32px uniform avatars; names alone; two filled eligibility pills; wide headers | Human identity with varied initials, 52–60px ordinary rows, compact stored tags and quiet purpose-specific server verdicts |
| Selection | Bulk highlight only; quick view covers the working list with an overlay | Distinct current-contact row; desktop inline context, responsive drawer below 1280px; bulk selection stays separate |
| Context | Identity spread across drawer header/avatar/status; long metadata stack; expanded eligibility block | Strong identity, contact information, tags, compact WhatsApp relationship, assignment and actual activity with fine dividers |
| Mobile | Horizontally scrolling desktop table | Contact cards with identity/phone, useful tags/eligibility and last incoming time; practical touch targets |

## Supported differences from the concept

No contact photo URL is supplied: use deterministic varied initials. Contact fields support phone/email/language/country, not invented location/company. `lastInboundAt` is last incoming message time, not last conversation time. Assignment is contact `ownerId`, distinct from conversation assignment; resolve names only from authorized existing team data, otherwise retain an honest teammate fallback. Eligibility remains purpose-specific output from the existing endpoint: no blanket eligibility inferred from consent, no new eligibility search backend. Bulk APIs support tag/untag/delete, not bulk assignment or selected-only export. Export retains the current filtered-directory scope and will say so explicitly. No star/favourite, CRM field, fake activity or invented screenshot counts.

## Verification and visual iteration

Before captures and final responsive review evidence will be retained under `experience-v2/evidence/contacts-reconstruction/`. Verify four widths, ordinary row geometry, inline/drawer selection and focus, server queries, bulk actions, errors/empty states, read-only permissions, centralized eligibility and Home/Inbox regression. Inspect the first populated reconstruction capture and correct composition/density before retaining final review captures.

## Implemented composition

The directory now opts into the approved Home/Inbox shell only at `/contacts`; no shared shell styles or Home/Inbox components changed. Contextual navigation sits below the heading, followed by one filter/directory surface. The existing server filter DSL remains authoritative: quick tag/assignment controls edit root rules without adding nesting or replacing the advanced builder. Export remains scoped to the filtered directory and is available under Columns.

Desktop identity rows use 36px deterministic avatars, name plus actual email/source, stored tags and compact service/marketing verdicts. Existing contact ownership resolves names through the authorized team endpoint; no membership or conversation ownership is invented. The selected-contact panel is 288px wide above 1280px; smaller widths use the existing drawer, and mobile uses cards with practical identity/selection/action targets. Desktop ordinary rows measure 57px; the selected three-tag fixture wraps to 61px. Real content is allowed to wrap rather than clip.

The panel groups identity, Message/More, contact information, tags, WhatsApp relationship, assignment, actual recent conversations and three latest activities. Full eligibility/consent and campaign history remain available through disclosures, and Open full profile retains the complete history. Message opens an existing authorized Inbox conversation; it does not create a new sending path. Contact creation, editing, consent notes, import/export, segment filters and tag/untag/delete keep their existing APIs and permission checks.

## Visual corrections and interaction regressions

Before captures show the generic table and overlay drawer. The first populated pass revealed wrapped tag/filter controls, an overly expanded relationship section and an activity-heavy panel. The correction integrates Columns into the filter bar, limits row tags with a count, puts Message/More beside the identity, summarizes server eligibility, and retains three latest activities with full history accessible elsewhere. A final capture revealed a broad timeline selector also resizing connector lines; removing that override preserves the shared Timeline primitive.

Responsive keyboard testing reproduced a focus-restoration bug during desktop-to-drawer handoff: the desktop trigger became hidden before the drawer closed. The directory now retains the contact ID separately from selected-preview state and resolves the visible identity trigger. More-menu Escape closes that menu without dismissing the panel; quick-view Escape restores the visible row action. Mobile identity accessible names include both the visible name and phone, avoiding label/content mismatch.

Test fixture corrections were kept separate from product behavior: row geometry measures an ordinary row rather than the legitimately wrapped selected row; bulk untag removes an existing tag instead of expecting a write count for an already-applied tag; simulated eligibility failures reload the shared query cache; search targets the semantic searchbox role.

No backend, contract, migration, billing setting, authentication or RLS changes are required. Later modules remain outside scope. Final review captures and concrete validation are recorded in the [Contacts evidence](experience-v2/evidence/contacts-reconstruction/README.md). Engineering checks do not confer visual approval; stop here for the user's Contacts review.

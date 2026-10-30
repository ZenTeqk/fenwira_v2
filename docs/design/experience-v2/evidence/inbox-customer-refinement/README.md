# Customer-panel refinement — 30 October 2026

The right-hand customer panel keeps its 320px dock and existing responsive drawer. A compact
heading, 40px shared identity avatar, wrapping profile, phone copy, contact link and permitted
contact editor sit above sticky 36px tabs. The profile, fields and tabs grow with text scaling.
The original shell, recently refined conversation list and centre-panel implementation are
preserved; protected source-file hashes were checked against the start of this refinement.

Overview orders assignment, semantic wrapping tags, labelled contact fields, contact notes,
messaging eligibility and automation. Existing write permissions and mutation endpoints remain
authoritative. Missing fields open the existing validated editor only for permitted roles.
Country names come from stored codes; custom fields preserve real labels and false/empty values.
Amber note cards preview three lines and expand to complete content. Counts include every note,
with Show all for additional cards. Contact notes remain separate from conversation internal notes.

Eligibility and automation start collapsed. Unknown eligibility never appears allowed; actual
server restrictions use small amber badges and expose their reasons and recorded consent when
expanded. Automation preserves active, manual-pause and agent-takeover distinctions in a neutral
badge. The centre panel retains the only countdown, template picker action and primary Resume.

Activity merges recorded contact tag/note audits with conversation assignment/automation system
events, newest first. Each source has an independent cursor and the older records are shown only
after both sources cover that interval. This does not mutate the chat's pagination or scroll
anchor. Files retain the existing type filters, permission-checked links, metadata and Jump to
message in compact rows. No full attachment list is repeated in Overview.

## Rendered review

Screenshots use isolated browser fixtures; no example customer data was added to the product.
The running desktop, phone drawer, long notes, activity timeline and file rows were visually
inspected. Relevant captures:

- [Desktop overview](inbox-1440.png)
- [Consistent numbered avatar and field rows](customer-identity-fields-1440.png)
- [Long tags and complete notes](customer-notes-tags-1440.png)
- [Read-only and restricted state](customer-read-only-1440.png)
- [Recorded activity](customer-activity-1440.png)
- [Compact files](customer-files-1440.png)
- [Phone drawer](customer-drawer-375.png)
- [Larger text](customer-scaled-text-1440.png)

## Validation

Repository lint, dependency-boundary/design-token checks and type checking pass. All 597 unit
tests pass, including six activity-ordering, cursor-coverage, deduplication and country-name
cases. Focused browser checks cover profile identity, clipboard success/error, editing, assignment
and pending submission protection, tag mutation/wrapping, empty/short/long notes, complete note
counts, unknown/closed/blocked eligibility, automation distinctions, independent activity
pagination and recovery, file loading/empty/error/retry/open/jump, and delayed responses while
switching customers. Drafts remain separate and intact. Responsive checks cover
1440/1280/1024/768/375px, panel closure/reopen and mobile focus return. Axe checks pass on the
reviewed states. Ten final browser scenarios pass against the rebuilt production app, including
real backend tag/note saves, authorized shared files and 390px navigation. The local web image
builds successfully and reports healthy. The profile/fields were also checked at 125% root text
size without horizontal overflow. No backend contracts, dependencies or global navigation changed.

## API limits

Contact photos, note edit/delete actions and detailed automation flow/applicability metadata
are not exposed by the existing contracts. Those controls and inferred details are omitted.
Activity covers the recorded events available through the existing contact audit and selected
conversation's message history; it does not invent a workspace-wide automation audit.

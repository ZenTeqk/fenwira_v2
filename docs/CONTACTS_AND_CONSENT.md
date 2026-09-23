# Contacts & Consent

## Scope

The contact model, phone normalization, dedupe, custom properties, tags, the filter DSL shared by lists, segments and campaigns, consent tracking and enforcement, CSV import and export, and the Contact 360 view.

## Decisions

### Contact identity

- A contact is unique per tenant by `phone_e164` (among non-deleted rows).
- **Normalization:** `libphonenumber-js` (`max` metadata). Input is parsed with the tenant's `default_country` as the region hint. If the result isn't `isValid()`, the input is rejected with `INVALID_PHONE`. Stored as E.164 (`+919876543210`).
- Inbound messages create contacts automatically (`source = INBOUND`, name from the WhatsApp profile name if no name is set).
- **Soft delete** hides the contact everywhere and frees the phone for re-creation. Messages keep their `contact_id`. A new inbound message from a deleted contact's number creates a *new* contact.
- `BLOCKED` status: no outbound sends at all (`CONTACT_BLOCKED`), inbound messages still recorded, and the conversation is auto-resolved.

### Core fields

`name, phone_e164, email, language (BCP-47), country (ISO-3166 alpha-2, derived from the phone if not set), source, status, owner_id`. Plus custom properties.

### Custom properties

- Defined per tenant (`contact_property_definitions`) with types TEXT, NUMBER, DATE, BOOLEAN and SELECT (with options). There is a limit of 100 active definitions per tenant.
- Keys are immutable `snake_case`. Labels are editable. Archiving hides a definition but keeps its values.
- Referenced in the DSL as `property.<key>` and in template variable mapping as `{{contact.property.<key>}}`.

### Tags

- Tenant-scoped, with case-insensitive unique names. Colors come from the fixed `tag_color` enum, mapped to design tokens (never free hex).
- The same `tags` table serves contact tags and conversation tags.

### Filter DSL (`packages/contracts/src/contacts/filter.ts`)

```ts
type ContactFilter = { op: 'AND' | 'OR'; rules: Array<Rule | ContactFilter> }   // max depth 3, max 50 rules
type Rule = { field: Field; operator: Operator; value?: unknown }

Field =
  | 'name' | 'phone' | 'email' | 'language' | 'country' | 'source' | 'status' | 'ownerId'
  | 'createdAt' | 'lastInboundAt'
  | `property.${string}`
  | 'tags'                                   // value: tagId[]
  | 'consent.marketing' | 'consent.utility'  // value: 'GRANTED' | 'REVOKED' | 'NONE'
  | 'segment'                                // value: segmentId (no nesting beyond one level)

Operator (valid per field type):
  text:    EQUALS, NOT_EQUALS, CONTAINS, NOT_CONTAINS, STARTS_WITH, EXISTS, NOT_EXISTS
  number:  EQUALS, NOT_EQUALS, GT, GTE, LT, LTE, BETWEEN, EXISTS, NOT_EXISTS
  date:    BEFORE, AFTER, BETWEEN, IN_LAST_DAYS, NOT_IN_LAST_DAYS, EXISTS, NOT_EXISTS
  boolean: IS_TRUE, IS_FALSE, EXISTS, NOT_EXISTS
  select/enum: IN, NOT_IN, EXISTS, NOT_EXISTS
  tags:    HAS_ANY, HAS_ALL, HAS_NONE
  consent: IS
```

- One compiler (`contacts/filter/compile.ts`) turns a filter into a Prisma `where`. It is used by the contact list, count, segments, bulk actions, exports and campaign audience. **No other code builds contact queries from user input.**
- Invalid field/operator combinations are rejected by the Zod schema. Unknown `property.*` keys return `VALIDATION_FAILED`.
- A property-based test (fast-check) generates filters and asserts `count(filter) == search(filter).length` over a seeded dataset.

### Segments

- Saved named filters. They are dynamic: membership is evaluated at query time.
- `cached_count` is refreshed on view and by the maintenance job. It is shown as "≈" with a timestamp.
- A campaign **snapshots** the segment at launch (see `CAMPAIGN_ENGINE.md`), so later segment changes don't affect a running campaign.

### Consent

| Concept | Rule |
| --- | --- |
| Channel | `WHATSAPP` (the only channel in v2; the enum allows more later) |
| Purposes | `MARKETING` (promotional templates, campaigns with marketing templates), `UTILITY` (transactional templates), `SERVICE` (replies inside the service window) |
| Current state | The latest `consents` row per `(contact, channel, purpose)`. The view `current_consents` exposes it. No row means `NONE`. |
| Evidence | Every row stores `source` plus `evidence` JSON (actor, IP, message ID, import job ID, file ID, note). Rows are never updated except to set `revoked_at`/`revoke_source` on the latest row. |
| History | The Consent tab shows every row, newest first, with its evidence. |

**Enforcement** (in `MessagingService`, see `MESSAGING_ENGINE.md`):

| Purpose | Requirement |
| --- | --- |
| MARKETING | Current consent must be `GRANTED` |
| UTILITY | Allowed unless the current UTILITY consent is `REVOKED` (Meta requires opt-in for business-initiated messages; tenants attest to this at connect time, and an explicit revocation always blocks) |
| SERVICE | Always allowed inside the service window (the customer initiated) |

**How consent changes**

| Trigger | Effect | Source |
| --- | --- | --- |
| Inbound text matches an opt-out keyword (case-insensitive, trimmed, whole message) | Revoke MARKETING. The system sends a confirmation reply (tenant-configurable text, as a SERVICE message). | `INBOUND_KEYWORD`, evidence `{messageId}` |
| Inbound matches an opt-in keyword | Grant MARKETING | `INBOUND_KEYWORD` |
| Meta error 131050 on a send | Revoke MARKETING | `META_OPT_OUT`, evidence `{messageId, errorCode}` |
| Manual change in the UI | Grant or revoke with a required note | `MANUAL`, evidence `{actorId, note, ip}` |
| Import with a `consent` column or a default consent | Grant/revoke per row | `IMPORT`, evidence `{importJobId, row}` |
| API | Grant/revoke | `API`, evidence `{apiKeyId}` |

- Default keywords: opt-out `STOP, UNSUBSCRIBE, CANCEL, STOP ALL, OPT OUT`; opt-in `START, SUBSCRIBE, OPT IN`. They are configurable per tenant in Settings → Workspace.
- Keyword handling runs in the `contacts.events` processor on `message.inbound.received`. It is idempotent: a repeat STOP doesn't create a duplicate row if marketing is already REVOKED.

### CSV import

```text
Upload (presigned PUT → files) → POST /imports {fileId}
 → Parse headers + first 50 rows (stream, papaparse, UTF-8 / UTF-8-BOM; ≤ 100k rows, ≤ 50 MB)
 → Column mapping: auto-suggest by header similarity (name, phone, mobile, whatsapp, email, tags, consent, property keys)
 → Validate (job): per-row phone normalization, email format, property type coercion, required fields
 → Duplicate detection: in-file (same phone → keep first, later rows errored DUPLICATE_IN_FILE) and existing (policy SKIP | UPDATE)
 → Preview: counts {valid, invalid, new, existing} + first 50 rows with per-cell errors
 → Confirm → import job (batches of 1,000 per transaction) → progress via WS import.progress
 → Complete: counts + downloadable error CSV (original row + error columns)
```

- Tags column: comma- or semicolon-separated names. Missing tags are created.
- The consent column accepts `yes/true/1/granted` or `no/false/0/revoked`. An empty cell uses the job's default consent, or none.
- Every imported contact gets a `contact.imported` activity. New contacts emit `contact.created` events (batched; automations triggered by Contact Created can be suppressed per import with `suppressAutomations: true`, which defaults to true for imports).
- A job can be cancelled while IMPORTING; rows committed so far stay.

### Export

The job writes a CSV of the filter result to `fenwira-exports` with core fields, tags, current consent per purpose and properties. It is streamed. The download URL is valid for 5 minutes and the file expires in 7 days. Exports are audit-logged with the filter and row count.

### Contact 360 (page `Contacts → :id`)

A header with name, phone (monospace), status, owner, tags and quick actions (message, edit, block). Tabs:

| Tab | Content |
| --- | --- |
| Overview | Core fields, custom properties (inline edit), current consent summary |
| Conversations | Conversations list with a link into the inbox |
| Campaigns | Campaign recipient rows (Phase 9) |
| Activities | `contact_activities` timeline |
| Consent | Full history with evidence |
| Notes | Contact notes |

## Open questions

| # | Question | Owner |
| --- | --- | --- |
| C1 | Is the UTILITY consent rule acceptable to legal: allowed unless explicitly revoked? | Legal |
| C2 | Is merging contacts (two contacts → one) needed in v2? Assumed no. | Product |

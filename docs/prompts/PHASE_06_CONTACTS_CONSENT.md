# Phase 6 — Contacts, Consent & CRM Foundation

**Goal:** contacts can be created, imported, tagged, filtered, segmented and consent-audited. This phase can run in parallel with Phase 7.

**Read:** `AGENTS.md`, `docs/CONTACTS_AND_CONSENT.md`, `docs/DATABASE.md`, `docs/API_SPEC.md`.

## Build

1. **Entities** (tenant-owned, with RLS):
   - `Contact` (name, phone_e164, email, language, country, source, status, owner_id, soft delete; unique `(tenant_id, phone_e164)`)
   - `ContactProperty` (tenant-defined custom fields: key, label, type ∈ text/number/date/boolean/select) plus the values
   - `Tag` (color from a fixed token list only), `ContactTag`
   - `ContactNote`
   - `Consent` (channel, purpose ∈ marketing/utility/service, status ∈ granted/revoked, source, captured_at, revoked_at, evidence JSON: who, how, IP, message ID, file)
   - `ContactActivity` (append-only timeline)
   - `Segment` (name plus a filter DSL JSON)
   - `ImportJob` (with rows and errors)
2. **Phone normalization:** libphonenumber to E.164, with a tenant default country. Invalid numbers are rejected with a reason.
3. **Filter DSL** (in `packages/contracts`): field/operator/value groups with AND/OR over core fields, custom properties, tags and consent status. One compiler turns it into Prisma queries and is used by list views, segments and later by campaigns.
4. **Consent:**
   - Consent is recorded on create/import (with a required source) and changed manually (with a note).
   - Inbound opt-out keywords (`STOP`, `UNSUBSCRIBE`, plus a configurable list) revoke marketing consent automatically and log the evidence message ID. Opt-in keywords can re-grant it.
   - Implement the Phase 5 `MessagingService` consent hook: a marketing-purpose send without granted consent is rejected.
5. **CSV import:** upload to MinIO, parse (streamed, up to 100k rows), auto-suggest column mapping, validate per row, detect duplicates (in-file and existing: skip / update / create policy), preview the first 50 rows with errors, confirm, then run the import as a BullMQ job with progress over WebSocket. Download an error report CSV. Every imported contact gets consent evidence `{source: 'import', import_job_id}`.
6. **Export:** CSV of the current filter, run as an async job with a MinIO presigned download. Permission `contacts.export`, and it is audit-logged.
7. **UI:**
   - Contacts → All Contacts: DataTable with filter builder, bulk tag/untag/delete (with confirm) and saved views.
   - Contact 360 page with tabs: Overview, Conversations (link into the inbox), Campaigns (placeholder until Phase 9), Activities, Consent (full history), Notes.
   - Segments (builder with a live count), Tags, and Imports (job list plus the wizard).
8. **Permissions:** `contacts.read`, `contacts.write`, `contacts.import`, `contacts.export`, `contacts.delete`.

## Acceptance criteria

- [ ] Importing a 50k-row CSV with 5% invalid rows and 10% duplicates completes, the counts match, and the error CSV is correct.
- [ ] An inbound "STOP" revokes marketing consent within seconds, and the Consent tab shows the evidence message.
- [ ] A marketing send to a contact without consent is rejected by `MessagingService` (test).
- [ ] A segment count equals the filtered list count for the same DSL (property-based test on generated filters).
- [ ] The cross-tenant matrix covers contacts, search, segments, imports and exports.
- [ ] Deleting contacts is a soft delete, and it is audit-logged.

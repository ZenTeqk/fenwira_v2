# Phase 4 — Meta Onboarding & WhatsApp Account Management

**Goal:** a new tenant connects its own WhatsApp Business account to Fenwira without a developer touching the database.

**Read:** `AGENTS.md`, `docs/META_INTEGRATION.md`, `docs/SECURITY.md` (secret encryption), `docs/DATABASE.md`.

## Build

1. **Entities** (tenant-owned, with RLS): `MetaBusinessAccount`, `WhatsAppBusinessAccount` (WABA), `WhatsAppPhoneNumber` (phone_number_id, display number, verified name, quality rating, messaging tier, status, last_synced_at), `MetaCredential` (encrypted token, token type, expiry, scopes, rotated_at) and `WebhookSubscription`.
   - A global unique on `phone_number_id` guarantees one tenant per number.
   - Platform-level config (Meta app ID, app secret, webhook verify token, Embedded Signup config ID, Graph API version) comes from env, never from the DB per tenant.
2. **Secret encryption:** `packages/config` crypto helper using AES-256-GCM with a key ID prefix, so keys can be rotated. `MetaCredential.token` is only ever decrypted inside the whatsapp client. Contracts never contain it. Add a log redaction rule for `token` and `access_token`.
3. **packages/whatsapp:** a typed Graph API client with a configurable version, timeouts, and error mapping to `{retryable, code, message}` per `META_INTEGRATION.md`. Endpoints needed in this phase: exchange code → token, debug token, list WABAs and phone numbers, subscribe the app to a WABA, register the phone number, and get phone number details and quality.
4. **Embedded Signup flow:** Settings → WhatsApp → **Connect WhatsApp** → launch the FB JS SDK with the config ID → receive the code plus WABA ID and phone number ID → `POST /api/v1/whatsapp/connections` → server exchanges the code, stores the credential encrypted, fetches the WABA and number, subscribes to webhooks, registers the number, validates it, and marks it **Connected**. Every step is idempotent and resumable. A failure shows which step failed and offers a retry.
5. **Dev connect:** behind `WHATSAPP_DEV_CONNECT=true` only, a form for the Meta test number and a system-user token. It is hidden in production builds.
6. **Connection management UI** (Settings → WhatsApp and Integrations → WhatsApp): a card per number with phone, connection status, webhook status, quality, tier and "last sync" (relative time). **Manage** (rename, disconnect with confirmation) and **Test Connection** (a live Graph call plus an optional test message to a number the user enters, sent through a temporary direct call that is flagged for removal in Phase 5). The token is shown masked (`EAAG…9f2c`). **Rotate token** re-runs the exchange.
7. **Background sync:** a repeatable BullMQ job refreshes quality, tier and status every 6 hours, and flags credentials that expire within 7 days.
8. **Permissions:** `whatsapp.manage` (OWNER and ADMIN). Every connection change is audit-logged, with the token never written to the log.

## Acceptance criteria

- [ ] With real Meta sandbox credentials, a new tenant completes Embedded Signup and sees **Connected** with no manual DB edits.
- [ ] The dev connect path works with the Meta test number and is absent when the flag is off.
- [ ] The raw token never appears in any API response, log line, audit entry or browser storage. Tests grep the responses and captured logs.
- [ ] Connecting a `phone_number_id` already owned by another tenant is rejected, without revealing that tenant.
- [ ] Disconnecting unsubscribes the webhooks and wipes the credential.
- [ ] Cross-tenant tests are extended to all new tables.

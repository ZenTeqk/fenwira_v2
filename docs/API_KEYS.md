# API Keys

## Scope

Tenant-scoped credentials that let an external system (a script, Lenz, a customer's own backend) call a curated subset of the Fenwira API as a workspace, without a human session. Decisions P11-D18 (the public API surface), P11-D22 (financial visibility stays permission-based, never a key concern) and P11-D23 (provider cost is never tenant-facing, API keys included).

## Authentication format

```
Authorization: Bearer fw_<prefix>_<secret>
```

- `fw_` — fixed scheme prefix.
- `<prefix>` — 8 lowercase alphanumeric characters, unique across the platform. Safe to log, display and search by; it is how a key is identified without ever touching the secret.
- `<secret>` — 20–128 URL-safe characters, 256 bits of entropy.

The full regex (`packages/contracts/src/api/api-keys.ts`): `/^fw_([A-Za-z0-9]{8})_([A-Za-z0-9_-]{20,128})$/`.

`ApiKeyGuard` (`apps/api/src/modules/api-keys/api-key.guard.ts`) runs first in the guard chain, ahead of the cookie-session guards. A request without an `Authorization: Bearer fw_...` header is untouched — the normal session guards run as usual. A request with one is decided by this guard alone; cookies are never consulted for it, and it is exempt from CSRF (there is no cookie to forge).

## One-time secret display

`POST /api-keys` returns `{ key, secret }` exactly once, at creation. The `secret` is the full bearer token (`fw_<prefix>_<secret>`) — store it in your own secrets manager immediately. No endpoint, response or log ever returns it again. If it's lost, revoke the key and create a new one.

## Hashing and storage

- The server never stores the secret. `hashApiKeySecret(pepper, secret) = sha256(\`${pepper}:${secret}\`)` (`apps/api/src/modules/api-keys/api-key-token.ts`), and only the resulting hash is written to `api_keys.key_hash`.
- `pepper` comes from `API_KEY_PEPPER`, a server-side secret (not per-key, not stored in the row) — without it, a stolen database dump is insufficient to forge or verify keys. Production refuses the development default.
- Verification uses `safeEqual` (constant-time compare, `packages/config/src/crypto.ts`) against the stored hash, so timing cannot leak how much of the secret matched.
- `system.resolve_api_key(prefix)` (`packages/database/sql/post-migrate.sql`) is the one SECURITY DEFINER function allowed to read `api_keys` across tenants — necessary because the guard doesn't know the tenant until it resolves the prefix. It is granted `SELECT` on exactly `id, tenant_id, key_hash, scopes, revoked_at, expires_at, prefix` — nothing else on the table, and the hash never leaves the database comparison.

## Prefix / key identification

The `prefix` is the only part of the token ever displayed, searched or logged — in the key list, in audit entries, in `lastUsedAt` bookkeeping. It carries no entropy by itself (8 lowercase alphanumeric characters is not a secret) and cannot be used to authenticate.

## Scopes

A key's scopes are permission keys from a fixed catalog (`API_KEY_SCOPES`, `packages/contracts/src/api/api-keys.ts`) — the exact set the public API surface needs, never the full permission catalog:

| Scope | Grants |
| --- | --- |
| `contacts.read` | Read contacts |
| `contacts.write` | Create and edit contacts |
| `inbox.read` | Read conversations and messages |
| `inbox.reply` | Send a reply into a conversation |
| `templates.read` | Read message templates |
| `campaigns.read` | Read campaigns and their stats |

Two rules, both enforced server-side at creation (`ApiKeysService.create`):

1. **Subset of the catalog.** `scopes` in the request is itself typed as this enum, so an out-of-catalog value is rejected as an ordinary `400 VALIDATION_FAILED` before the service runs.
2. **Subset of the creator's own permissions.** A member can never grant a key more than their own role already has. Violating this (presently unreachable through the UI, since only OWNER/ADMIN — who hold every catalog scope — can create keys at all) answers `422 API_KEY_SCOPE_INVALID`.

At request time, `tenant.permissions` for an API-key request *is* the key's scopes, so the existing `PermissionGuard` enforces "the key's scope must include the route's permission" with no separate scope-checking code path to drift from route enforcement.

**Never exceeds the public allowlist.** `ApiKeyGuard` requires both `@PublicApi()` and `@RequirePermission(...)` on a route; a route with only one, or neither, answers `404 Not Found` to a key — never `403` — so the private surface is never discoverable by probing with a valid key. See *Public route allowlist* below.

## Suspended by plan (Phase 11 Step 4)

Without `api_enabled` (a plan without API access, or a subscription EXPIRED/CANCELLED), every API-key request gets 403 `ENTITLEMENT_REQUIRED`. Keys are never deleted or revoked by this: they stay listed (`GET /api-keys` returns `meta.entitled: false`) and revocable, and work again as soon as the entitlement returns.

## Expiration

`expiresAt` is optional at creation (`POST /api-keys`); unset means the key never expires. An expired key fails authentication with the same generic `401` as a garbage or revoked token (see *Errors*) — expiry is never distinguishable from "wrong secret" by response shape, by design.

## Revocation

`DELETE /api-keys/:id` sets `revokedAt`/`revokedBy` and is irreversible — there is no "unrevoke". A revoked key's very next request fails authentication immediately; nothing is cached. Revoking is audited (`api_key.revoked`).

## Rate limiting

Every authenticated key request is rate-limited per key (not per tenant, not globally), via the shared `RateLimitService` bucket `api_key:<keyId>`, limit `API_KEY_RATE_LIMIT_PER_MINUTE` (default 120/minute) over a 60-second window. Exceeding it answers `429 RATE_LIMITED` with a `Retry-After` header. This is independent of, and additional to, any human-session rate limits.

## Audit behavior

Every mutation reachable by a key is attributed to it, not to a human:

- `AuditService.write` and the contact-activity timeline (`addActivity`) set `actorType: 'API_KEY'`, `actorId: <api key id>` whenever the request context carries an `apiKey` rather than a human `auth` session.
- `api_key.created` and `api_key.revoked` are themselves audited, attributed to the signed-in member who performed them (keys cannot create or revoke other keys).
- `lastUsedAt` is updated on every successful authentication — visible in the key list as "Last used …", and the only usage signal retained (no per-request body or path logging for key traffic beyond the platform's normal structured request logs, which never include the secret).

## Tenant isolation

A key resolves to exactly one `tenant_id` at creation and can never act outside it: `ApiKeyGuard` sets `requestContext.tenant.tenantId` from the row `system.resolve_api_key` returned, and every downstream query goes through the same tenant-scoped Prisma client (`db.withTenant`) as a human session — Postgres RLS is the enforcement boundary either way (`docs/MULTI_TENANCY.md`). There is no cross-tenant key, and no key-level override of `X-Tenant-Id`.

A tenant API key must **not** reach: platform administration, provider-cost or internal financial data (P11-D23), internal financial operations, tenant membership/security administration, unrestricted audit/security data, or any other tenant's resources. All of these are enforced simply by never appearing on the public allowlist — not by a special-cased check.

## Public route allowlist (decision P11-D18, pinned by `test/openapi.test.ts`)

Exactly these 18 routes carry `@PublicApi()` + `@RequirePermission(...)`, and therefore can ever be reached by an API key. The committed `docs/openapi.json`'s `x-public: true` flags and this list are the same set, cross-checked by a test — not maintained by hand in two places.

| Method | Path | Required scope |
| --- | --- | --- |
| `POST` | `/contacts/search` | `contacts.read` |
| `GET` | `/contacts/{id}` | `contacts.read` |
| `POST` | `/contacts` | `contacts.write` |
| `PATCH` | `/contacts/{id}` | `contacts.write` |
| `GET` | `/contacts/{id}/consents` | `contacts.read` |
| `POST` | `/contacts/{id}/consents` | `contacts.write` |
| `POST` | `/conversations` | `inbox.reply` |
| `GET` | `/conversations/{id}` | `inbox.read` |
| `GET` | `/messages/{id}` | `inbox.read` |
| `POST` | `/conversations/{id}/messages` | `inbox.reply` |
| `GET` | `/templates` | `templates.read` |
| `GET` | `/templates/approved` | `templates.read` |
| `GET` | `/campaigns` | `campaigns.read` |
| `GET` | `/campaigns/{id}` | `campaigns.read` |
| `GET` | `/campaigns/{id}/stats` | `campaigns.read` |
| `GET` | `/graph/{phoneNumberId}` | `inbox.reply` |
| `POST` | `/graph/{phoneNumberId}/media` | `inbox.reply` |
| `POST` | `/graph/{phoneNumberId}/messages` | `inbox.reply` |

Growing this list is a product decision (a new row in this table and `test/openapi.test.ts`'s `ALLOWLIST_V1`), never a side effect of adding `@RequirePermission` to a new route.

### API-key-specific behavior on the allowlist

A few routes behave slightly differently under key auth than under a human session, because a key has no human actor:

- **Starting a conversation / sending a reply** (`POST /conversations`, `POST /conversations/{id}/messages`): attributed as `source: 'API'`; an API-key reply bypasses the human compose lock and per-agent takeover rules (there is no agent to take over from) and calls `MessagingService.send` directly.
- **`currentActorId()`** returns `null` for an API-key request instead of throwing, at the handful of call sites that record a human `createdBy`/`actorId` (`contacts.create`, `contacts.changeConsent`) — those columns have no foreign key to `users`, so `null` is safe and simply means "not a human."

## Meta-compatible send

An integration already built for Meta's Cloud API switches to Fenwira by changing two settings: the base URL `https://graph.facebook.com/{version}` becomes `https://api.fenwira.com/api/v1/graph`, and the Meta access token becomes a Fenwira API key with `inbox.reply`. Request and response bodies keep Meta's shape, so the integration's message-building code is unchanged. Every send goes through `MessagingService` (source `API`) with the same eligibility, window, balance and entitlement checks as any other send, and appears in the Inbox with live status.

| Meta call | Fenwira | Notes |
| --- | --- | --- |
| `GET /{phone-number-id}` | `GET /graph/{phoneNumberId}` | Returns `id`, `display_phone_number`, `verified_name`; a connection test. |
| `POST /{phone-number-id}/media` (multipart `file`, `type`) | `POST /graph/{phoneNumberId}/media` | Stores the file in Fenwira (accepted types, Meta's size limits, magic bytes; at most 16 MB) and returns `{ id }`, a Fenwira file id. |
| `POST /{phone-number-id}/messages` | `POST /graph/{phoneNumberId}/messages` | `template` and `text` only. Returns `messages[0].id` = the Fenwira message id (`GET /messages/{id}` for status), not a wamid: the send is queued. |

- `{phoneNumberId}` is Meta's phone number id of a number connected to the key's workspace, or `default` for the default number. Any other value answers 404.
- A template header media `id` that is a Fenwira file id (from `/media`) becomes the message's header file: the worker uploads it to Meta at send time, and the Inbox shows the attachment. A `link`, or any other id, is passed to Meta unchanged.
- `Idempotency-Key` is optional here (Meta has none); with one, a retry returns the same message and never sends twice. Without one, each request is a new send.
- Errors use Fenwira's shape, `{ "error": { "code", "message" } }`, so a client reading `error.message` keeps working; Meta's numeric codes are not reproduced.

## Errors

| Code | Status | When |
| --- | --- | --- |
| `UNAUTHENTICATED` | 401 | Malformed token, unknown prefix, revoked, expired, or hash mismatch — one generic message for all of these, so a caller can never distinguish "wrong secret" from "doesn't exist" from "expired" |
| `NOT_FOUND` | 404 | The route isn't on the public allowlist (or carries no `@RequirePermission`) — identical to a route that doesn't exist at all |
| `FORBIDDEN` | 403 | The route is public, but the key's scopes don't include its required permission (same response a human member with the wrong role would get) |
| `ENTITLEMENT_REQUIRED` | 403 | The workspace's plan doesn't include `api_enabled` (details: `{ key: 'api_enabled' }`) |
| `RATE_LIMITED` | 429 | Over `API_KEY_RATE_LIMIT_PER_MINUTE` for this key; `Retry-After` header set |
| `API_KEY_SCOPE_INVALID` | 422 | Creating a key with a scope outside the catalog or outside the creator's own permissions |
| `VALIDATION_FAILED` | 400 | Request body fails the Zod contract (e.g. a scope not even in the enum) |

## Examples

### Authenticating a request

```bash
curl https://api.fenwira.com/api/v1/contacts/search \
  -X POST \
  -H "Authorization: Bearer fw_<prefix>_<secret>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Error response

```json
{
  "error": {
    "code": "UNAUTHENTICATED",
    "message": "Invalid or missing API key.",
    "correlationId": "0199-..."
  }
}
```

### Creating a key (as a signed-in OWNER/ADMIN)

```http
POST /api/v1/api-keys
{
  "name": "Lenz integration",
  "scopes": ["contacts.read", "contacts.write"],
  "expiresAt": "2027-01-01T00:00:00Z"
}
```

```json
{
  "data": {
    "key": {
      "id": "...", "name": "Lenz integration", "prefix": "a1b2c3d4",
      "scopes": ["contacts.read", "contacts.write"],
      "createdBy": "...", "createdByName": "Asha Rao",
      "lastUsedAt": null, "expiresAt": "2027-01-01T00:00:00.000Z",
      "revokedAt": null, "createdAt": "2026-10-04T12:00:00.000Z"
    },
    "secret": "fw_<prefix>_<secret>"
  }
}
```

`secret` appears in this response once — this is the one and only time.

## UI

`/integrations/api` (Design System v1, `apps/web/app/(app)/integrations/api/page.tsx`): a developer-product surface, not a database table. API keys are listed as cards (name, masked prefix, scope chips, last-used/created/expiry, status) with **Manage** (a read-only detail drawer) and **Revoke** (a confirmation explaining that dependent integrations stop authenticating immediately). Creation is a focused dialog — name, a checklist of only the scopes the creator's own role holds, expiration — and ends with the one-time secret dialog described above. Visibility of the whole page follows `integrations.manage` from the backend (`PermissionState` when absent); nothing is merely hidden client-side that the API would still allow.

## Phase 11 closure verification

The public route catalog and scope schema exclude platform operations. The combined enforced lifecycle verifies that an existing key is preserved and denied during entitlement loss, then works after valid restoration. Role/key/platform separation and cross-tenant authorization are recorded in [closure evidence](plans/PHASE_11_CLOSURE.md).

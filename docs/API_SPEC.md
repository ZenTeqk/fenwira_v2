# API Specification

## Scope

Conventions for every HTTP endpoint, plus the endpoint inventory per phase. Request and response bodies are defined as Zod schemas in `packages/contracts/src/api/**` (the schemas are the source of truth; this doc names them). Each phase appends its endpoints here when it ships.

## Conventions

### Base

- Base path: `/api/v1`. Webhooks are outside the prefix: `/webhooks/*`. Health endpoints are outside it too: `/health*`.
- JSON only (`application/json; charset=utf-8`), except file upload URLs (presigned) and CSV downloads (presigned).
- Field names are `camelCase`. IDs are UUIDv7 strings. Times are ISO 8601 UTC with `Z`. Money is `{ amountMinor: number, currency: "INR" }`.
- Enums are sent as their `UPPER_SNAKE` DB values.

### Authentication and context

| Header / cookie | Purpose |
| --- | --- |
| `fw_at` cookie | User access token (see `SECURITY.md`) |
| `Authorization: Bearer fw_<prefix>_<secret>` | API key (alternative to cookies, `docs/API_KEYS.md`); runs through a separate guard ahead of the cookie guards, decides the request alone when present |
| `X-Tenant-Id` | Required on tenant-scoped routes for cookie auth. Ignored for API keys — the key's own tenant is resolved from its prefix. |
| `X-CSRF-Token` | Required on cookie-authenticated mutations. The `fw_csrf` cookie is HttpOnly; clients get the value from login/refresh/`/auth/me` bodies. |
| `X-Correlation-Id` | Optional inbound, always returned |
| `Idempotency-Key` | Required on the endpoints marked **IK**, optional elsewhere on POST |

### Responses

Single resource: `200 { "data": { … } }`. Created: `201 { "data": { … } }`. No content: `204`.

List:

```json
{ "data": [ … ], "page": { "nextCursor": "opaque-or-null", "hasMore": true, "limit": 25 } }
```

- Cursor pagination: `?limit=25&cursor=…`. `limit` is between 1 and 100 (default 25). The cursor is opaque base64url of `{sortValue, id}`.
- Sorting: `?sort=-createdAt` (allow-listed fields per endpoint).
- Filtering: simple params (`?status=OPEN&assigneeId=…`) for fixed filters. Contacts and segments take a DSL in the body of `POST /contacts/search` (see `CONTACTS_AND_CONSENT.md`).
- Counting: a list never returns totals by default. `GET …/count` exists where the UI needs it.

### Errors

```json
{
  "error": {
    "code": "CONVERSATION_WINDOW_CLOSED",
    "message": "The 24-hour service window is closed. Send an approved template instead.",
    "details": { "windowExpiredAt": "2026-09-23T10:00:00Z" },
    "fieldErrors": [ { "path": "content.text", "code": "too_big", "message": "…" } ],
    "correlationId": "0192…"
  }
}
```

| HTTP | Typical codes |
| --- | --- |
| 400 | `VALIDATION_FAILED` (with `fieldErrors`), `INVALID_CURSOR` |
| 401 | `UNAUTHENTICATED`, `SESSION_EXPIRED`, `INVALID_CREDENTIALS`, `TOTP_REQUIRED` (202 challenge flow) |
| 403 | `FORBIDDEN` (missing permission), `CSRF_FAILED`, `ENTITLEMENT_REQUIRED`, `EMAIL_NOT_VERIFIED`, `TWO_FACTOR_ENROLLMENT_REQUIRED` |
| 400/401 (auth) | `TOKEN_INVALID` (verification/reset/invitation link used or expired), `INVALID_CODE` (wrong 2FA code) |
| 404 | `NOT_FOUND`, `TENANT_NOT_FOUND` (also used for tenants you don't belong to) |
| 409 | `CONFLICT`, `EMAIL_TAKEN`, `IDEMPOTENCY_KEY_REUSED` (different body), `IDEMPOTENCY_IN_PROGRESS`, `COMPOSE_LOCKED`, `VERSION_CONFLICT`, `PHONE_NUMBER_ALREADY_CONNECTED` |
| 422 | Domain rule violations: `WHATSAPP_CONNECT_FAILED` (with `details.steps`), `CONVERSATION_WINDOW_CLOSED`, `CONSENT_REQUIRED`, `CONTACT_BLOCKED`, `INVALID_PHONE`, `AUTOMATION_BLOCKED_BY_TAKEOVER`, `NO_CONNECTED_NUMBER`, `TEMPLATE_NOT_APPROVED`, `TEMPLATE_VARIABLES_INVALID`, `TEMPLATE_*` (validation codes in `TEMPLATE_ENGINE.md`), `FLOW_*` (validation codes in `AUTOMATION_ENGINE.md`), `LIMIT_EXCEEDED`, `INSUFFICIENT_BALANCE`, `SUBSCRIPTION_INACTIVE` |
| 429 | `RATE_LIMITED` (+ `Retry-After`) |
| 5xx | `INTERNAL`, `UPSTREAM_UNAVAILABLE` (503: Redis, Postgres or Meta unreachable — a dependency outage, not a bug) |

Error codes are a closed enum in `packages/contracts/src/errors.ts`, and the web app maps them to user copy.

### Idempotency

- `Idempotency-Key`: 8–128 characters, unique per `(tenant, scope)` for 24 hours. Implemented by `IdempotencyInterceptor` (`idempotency_keys` table); a missing key on an **IK** endpoint is 400. Replays carry `Idempotent-Replayed: true`, and a failed request releases its key.
- First request: the key row is locked, the handler runs, and the status and body are stored.
- Replay with the same body hash returns the stored response. With a different body it returns 409 `IDEMPOTENCY_KEY_REUSED`. While the first request is still running, it returns 409 `IDEMPOTENCY_IN_PROGRESS`.

### Concurrency

Mutable aggregates edited in forms (contacts, templates drafts, campaigns drafts, flow drafts) return `updatedAt`. Updates send `If-Match: "<updatedAt>"`, and a stale value returns 409 `VERSION_CONFLICT`.

### OpenAPI

An OpenAPI 3.1 document is maintained for the API (decision API1) at `docs/openapi.json`. `apps/api/src/openapi/openapi.ts` generates it from the NestJS route metadata and the Zod schemas the routes validate with (Zod's JSON Schema output), so it can't drift from what the API accepts.

- It covers every route: path, query and body schemas, `X-Tenant-Id`, `X-CSRF-Token` and `Idempotency-Key` headers where required, the session cookie, and the permission (`x-permission`) or role (`x-role`) each route needs.
- Success responses are documented as the `{ data, page?, meta? }` envelope, and errors as the error envelope. Per-route typed response bodies are not generated yet.
- `pnpm openapi` regenerates it. A unit test validates it against the OpenAPI 3.1 schema and fails when the committed file is stale, and CI runs `openapi.mjs --check`.
- The external/public API (API keys) is delivered in Phase 11.

### Versioning

Breaking changes go to `/api/v2`. Additive changes (new optional fields, new endpoints, new enum values documented as extensible) are allowed in v1.

---

## Endpoint inventory

Legend: **P** = required permission. **IK** = Idempotency-Key required.

### Health (P1)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | Liveness summary |
| GET | `/health/live` | Process up |
| GET | `/health/ready` | Postgres, Redis and queue checks. 503 if any is down. |

### Auth & identity (P3). No tenant header. Implemented.

Auth column: **Public** = no session needed. **Session** = the `fw_at` cookie (and `X-CSRF-Token` on mutations). Rate limits are in `SECURITY.md` → Rate limits.

| Method | Path | Auth | Request → response |
| --- | --- | --- | --- |
| POST | `/auth/register` | Public | `{name, email, password}` → 201 `{data: {status: 'AUTHENTICATED', csrfToken}}` plus session cookies. A verification email is queued. 409 `EMAIL_TAKEN`; 400 `VALIDATION_FAILED` (a breached password has field code `breached`). |
| POST | `/auth/email/verify` | Public | `{token}` → 204. 400 `TOKEN_INVALID` (used, expired or unknown). |
| POST | `/auth/email/resend` | Session | → 202 (no-op if already verified) |
| POST | `/auth/login` | Public | `{email, password}` → 200 `{data: {status: 'AUTHENTICATED', csrfToken}}` plus cookies, or **202** `{data: {status: 'TOTP_REQUIRED', challengeToken}}` with no cookies. 401 `INVALID_CREDENTIALS` (same for an unknown email). |
| POST | `/auth/2fa/verify` | Public | `{challengeToken, code}` (6-digit TOTP or `xxxxx-xxxxx` backup code) → 200 as for login. 401 `INVALID_CODE`/`TOKEN_INVALID`; 429 after 5 attempts per challenge. |
| POST | `/auth/refresh` | `fw_rt` cookie | → 200 `{data: {csrfToken}}` plus rotated cookies. 401 `SESSION_EXPIRED` clears cookies. Reusing a rotated token revokes the whole session family. |
| POST | `/auth/logout` | Session | → 204, cookies cleared, session family revoked immediately |
| POST | `/auth/password/forgot` | Public | `{email}` → always 202 (no account enumeration) |
| POST | `/auth/password/reset` | Public | `{token, password}` → 204. Revokes every session; marks the email verified. |
| GET | `/auth/me` | Session | → `{data: {user, memberships: [{membershipId, tenantId, tenantName, tenantSlug, role, permissions[], require2fa}], csrfToken, features: {managedLaunch}}}`. `features` are platform switches (ADR-0027). |
| PATCH | `/me` | Session | `{name?, timezone?, locale?}` → `{data: user}` (avatar upload arrives with MinIO files in Phase 5) |
| POST | `/me/password` | Session | `{currentPassword, newPassword}` → 204. Revokes all other sessions. |
| GET | `/me/sessions` | Session | → `{data: [{id, userAgent, ip, createdAt, lastUsedAt, current}]}`, one entry per session family |
| DELETE | `/me/sessions/:id` | Session | → 204. The session's access token stops working immediately (Redis deny-set). |
| POST | `/me/sessions/revoke-others` | Session | → `{data: {revoked}}` |
| GET | `/me/security-events` | Session | → `{data: [{id, type, ip, userAgent, createdAt}]}`, the latest 50 |
| POST | `/me/2fa/setup` | Session | → `{data: {secret, otpauthUri}}` (the secret is stored encrypted, not yet enabled) |
| POST | `/me/2fa/enable` | Session | `{code}` → `{data: {backupCodes[10]}}`, shown once |
| POST | `/me/2fa/disable` | Session | `{password, code}` → 204 |
| POST | `/tenants` | Session | `{name, country='IN', timezone='Asia/Kolkata'}` → 201 `{data: workspace}`. The caller becomes OWNER. 403 `EMAIL_NOT_VERIFIED`. |
| GET | `/invitations/:token` | Public | → `{data: {workspaceName, inviterName, email, role, expiresAt, existingAccount}}`. 404 `TOKEN_INVALID`. |
| POST | `/invitations/:token/accept` | Public, session optional | Signed in as the invited email: `{}`. New account: `{name, password}`, which also starts a session. → `{data: {tenantId, csrfToken?}}`. 409 `CONFLICT` with `details.reason` `SIGN_IN_REQUIRED` or `EMAIL_MISMATCH`. |

### Workspace, team, audit (P3). Tenant-scoped. Implemented.

Every route needs `X-Tenant-Id` plus an ACTIVE membership. A missing, malformed, foreign or deleted tenant returns **404 `TENANT_NOT_FOUND`**. A missing permission returns 403 `FORBIDDEN` with `details.permission`. If the workspace has `require2fa` and the caller has no 2FA, every route returns 403 `TWO_FACTOR_ENROLLMENT_REQUIRED`. The integration suite checks every route here against both matrices, which it generates from route metadata.

| Method | Path | P | Notes |
| --- | --- | --- | --- |
| GET / PATCH | `/workspace` | `workspace.read` / `workspace.manage` | PATCH `{name?, country?, timezone?, require2fa?}`, audited as a diff |
| DELETE | `/workspace` | OWNER | Soft delete, 204. Recoverable for 30 days, then purged or anonymized (T2/T3, `MULTI_TENANCY.md` → Tenant deletion). |
| POST | `/workspaces/:id/restore` | OWNER of that workspace (no tenant header) | Restores a workspace pending deletion (T3). 404 after the grace period. |
| POST | `/workspace/transfer-ownership` | OWNER | `{membershipId}` → 204. The old owner becomes ADMIN, atomically. |
| GET | `/team/members` | `team.read` | `[{membershipId, userId, name, email, role, status, twoFactorEnabled, joinedAt}]` |
| PATCH | `/team/members/:id` | `team.manage` | `{role}` (never OWNER). 403 above the caller's own rank; 409 for self or for the owner. |
| POST | `/team/members/:id/deactivate` · `/reactivate` | `team.manage` | 409 for self or for the owner. Access is lost immediately. |
| GET | `/team/invitations` | `team.manage` | Pending and expired invitations |
| POST | `/team/invitations` | `team.manage` | `{email, role}` → 201. 409 if already a member or already invited. Limit 50 per workspace per hour. |
| POST | `/team/invitations/:id/resend` | `team.manage` | 202. A new token replaces the old one (the old link dies). |
| POST | `/team/invitations/:id/revoke` | `team.manage` | 204 |
| GET | `/roles` | `roles.read` | `{roles: [{key, label, rank, permissions[]}], permissions: [{key, description}]}` |
| GET | `/audit-logs` | `audit.view` | `?action=<prefix>&actorId&from&to&limit&cursor` → `{data, page}` |
| GET / POST | `/notifications`, `/notifications/:id/read`, `/notifications/read-all` | self | Phase 7 |

### WhatsApp accounts (P4)

| Method | Path | P |
| --- | --- | --- |
| GET | `/whatsapp/connections` | `whatsapp.read` (numbers with status, quality, tier, webhook, lastSync, maskedToken) |
| POST | `/whatsapp/connections` **IK** | `whatsapp.manage`. `{code, wabaId, phoneNumberId}` from Embedded Signup. Returns a connection with `steps[]`. |
| POST | `/whatsapp/connections/dev` | `whatsapp.manage`. Only when `WHATSAPP_DEV_CONNECT=true`. |
| POST | `/whatsapp/connections/:id/retry` | `whatsapp.manage`. Resumes the failed step. |
| POST | `/whatsapp/connections/:id/test` | `whatsapp.manage`. `{to?}` sends a test message through `MessagingService`. |
| POST | `/whatsapp/connections/:id/sync` | `whatsapp.manage` |
| POST | `/whatsapp/connections/:id/rotate-token` | `whatsapp.manage`. `{code}` |
| PATCH | `/whatsapp/connections/:id` | `whatsapp.manage`. `{isDefault}` |
| DELETE | `/whatsapp/connections/:id` | `whatsapp.manage`. Disconnects. |
| GET | `/config/whatsapp-signup` | `whatsapp.manage`. `{embeddedSignup, appId, configId, graphVersion, devConnect}` (all public values) |

Implementation notes (Phase 4):

- A connection (`WhatsAppConnection` in `@fenwira/contracts`) carries status, quality, tier, webhook status, `lastSyncedAt`, `steps[]` and `credential {status, tokenType, maskedToken, expiresAt}`. No response ever contains a token. `maskedToken` looks like `EAAG…9f2c`.
- `POST /whatsapp/connections` and `/dev`: a failure before anything is stored (EXCHANGE, VERIFY, FETCH) returns **422 `WHATSAPP_CONNECT_FAILED`** with `details {step, steps}`. The user restarts signup, because the code is single-use. A number that is live in another workspace returns **409 `PHONE_NUMBER_ALREADY_CONNECTED`**, which never reveals that workspace. A failure after storing (SUBSCRIBE, REGISTER, VALIDATE) returns **201** with `status: ERROR` and the failed step, and `POST /:id/retry` resumes from it.
- Connecting is naturally idempotent per `(tenant, phoneNumberId)`: repeating it reuses the row and re-runs the steps.
- `POST /:id/test`: a live Graph check of the number and its token, returning `{ok, status, qualityRating, error?}` (200 even when Meta rejects the call). Since Phase 5 a test message is an ordinary send: `POST /conversations` with the `hello_world` template.
- `POST /:id/rotate-token`: `{code}` (Embedded Signup) or `{accessToken}` (developer connect only).
- `PATCH /:id`: `{isDefault: true}` and/or `{label}`.
- Rate limits per tenant: connect/rotate 20/h, test 30/h, sync 30/h.
- **Managed Launch Mode (ADR-0027):** with `MANAGED_LAUNCH_MODE=true`, `GET /config/whatsapp-signup`, `POST /whatsapp/connections`, `/dev`, `/:id/retry`, `/:id/sync`, `/:id/rotate-token` and `DELETE /:id` return **404 `NOT_FOUND`** before validation. Listing, `PATCH` and `/:id/test` are unchanged. Operators manage the connection from `/platform`.

### Webhooks (P5). Public, no auth.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/webhooks/whatsapp` | Meta verification handshake |
| POST | `/webhooks/whatsapp` | Signed events. Always a fast 200 after persisting. |
| POST | `/webhooks/automation/:token` | P10 flow trigger. HMAC optional per flow. |

### Messaging & inbox (P5/P7)

| Method | Path | P |
| --- | --- | --- |
| GET | `/conversations` | `inbox.read`. Filters: `status, assigneeId, unassigned, tagId, unread, window=OPEN\|CLOSED, phoneNumberId, q` |
| GET | `/conversations/:id` | `inbox.read` |
| GET | `/conversations/:id/messages` | `inbox.read`. Paginated backwards (`before` cursor). |
| POST | `/conversations/:id/messages` **IK** | `inbox.reply`. `{type, content}` or `{templateVersionId, variables}` |
| POST | `/conversations/:id/read` | `inbox.read` |
| POST | `/conversations/:id/assign` | `inbox.assign_self` (self) / `inbox.reassign` (others) |
| POST | `/conversations/:id/status` | `inbox.reply`. `{status, snoozedUntil?}` |
| POST | `/conversations/:id/automation-state` | `inbox.reply`. `{state}` |
| POST | `/conversations/:id/compose-lock` / DELETE | `inbox.reply` |
| GET / POST | `/conversations/:id/notes` | `inbox.read` / `inbox.reply` |
| PUT / DELETE | `/conversations/:id/tags/:tagId` | `inbox.reply` |
| POST | `/files/upload-url` | Authenticated. `{purpose, mimeType, sizeBytes}` → `{fileId, url, headers}` |
| POST | `/files/:id/complete` | Verifies the object and sniffs its type → READY or REJECTED |
| GET | `/files/:id/download-url` | Scoped by file purpose permission |
| GET | `/canned-replies` | `inbox.reply`. `?q=` filters by shortcut or title. |
| POST | `/canned-replies` | `inbox.canned_replies.manage`. `{shortcut, title, body}`; the shortcut is unique per workspace → 409 `CONFLICT` |
| PATCH / DELETE | `/canned-replies/:id` | `inbox.canned_replies.manage` |
| POST | `/messages/:id/retry` | `inbox.reply`. Only for FAILED messages with a retryable error. (Deferred; not built in Phase 7) |
| GET | `/conversations/:id/compose-lock` | `inbox.read`. `{conversationId, holder: {id, name} \| null, expiresAt}` |
| GET | `/inbox/presence` | `inbox.read`. Members with `inbox.reply` and their `ONLINE\|AWAY\|OFFLINE` status |
| GET | `/inbox/unread-count` | `inbox.read`. Conversations with unread > 0 visible to the caller (nav badge) |
| GET | `/notifications` | `workspace.read`. The caller's own notifications, newest first |
| POST | `/notifications/read-all`, `/notifications/:id/read` | `workspace.read` |
| GET / PATCH | `/workspace/inbox-settings` | `workspace.read` / `workspace.manage`. `{autoAssign, inboxVisibility, takeoverAutoReleaseHours}` |

Implemented in Phase 5: `GET /conversations` (newest first, cursor; inbox filters arrive in Phase 7), `POST /conversations` **IK** (`{to, phoneNumberId?, content}` starts or continues a conversation with a phone number, usually a template), `GET /conversations/:id`, `GET /conversations/:id/messages` (newest first, `before` cursor), `POST /conversations/:id/messages` **IK** (`{content}`), `POST /conversations/:id/read` (queues Meta's read receipt), `GET /messages/:id`, and the three `/files` endpoints for message media (`inbox.reply` to upload, `inbox.read` to download). Sendable content in v1: `TEXT`, `IMAGE`/`DOCUMENT`/`AUDIO`/`VIDEO` with a READY `fileId`, and `TEMPLATE {name, language, components?}` (template management is Phase 8). Send errors: 422 `NO_CONNECTED_NUMBER`, `CONTACT_BLOCKED`, `CONVERSATION_WINDOW_CLOSED`, `FILE_NOT_READY`. Uploads are checked on `complete`: the size must match and JPEG, PNG, PDF and MP4 files must carry the right magic bytes, or the file becomes REJECTED.

### Contacts (P6)

| Method | Path | P |
| --- | --- | --- |
| POST | `/contacts/search` | `contacts.read`. `{filter, sort, limit, cursor}` |
| POST | `/contacts/count` | `contacts.read` |
| POST | `/contacts` | `contacts.write` (consent source required if granting) |
| GET / PATCH / DELETE | `/contacts/:id` | read / write / `contacts.delete` |
| POST | `/contacts/bulk` | `{action: TAG\|UNTAG\|DELETE, contactIds \| filter, tagId?}` |
| GET | `/contacts/:id/activities`, `/contacts/:id/consents`, `/contacts/:id/conversations` | `contacts.read` |
| POST | `/contacts/:id/consents` | `contacts.write`. `{purpose, status, note}` |
| GET | `/contacts/:id/eligibility?conversationId=` | `contacts.read`. Read-only summary from MessageEligibilityService (C1 stays the only decider): `{marketingTemplate, utilityTemplate, freeform}` each `{allowed, code, reason, optedOut}`, plus `serviceWindowExpiresAt` (the given or most recent conversation). Added with Design System v1 so the UI explains restrictions without re-implementing them. |
| GET / POST | `/contacts/:id/notes` | read / write |
| CRUD | `/contact-properties` | read / `contacts.properties.manage` |
| CRUD | `/tags` | read / `contacts.write` |
| CRUD | `/segments` | read / `contacts.write` |
| POST | `/imports` | `contacts.import`. `{fileId}` → job (parses headers, suggests a mapping) |
| PATCH | `/imports/:id` | `{columnMapping, duplicatePolicy, defaultConsent}` → validate |
| GET | `/imports/:id`, `/imports/:id/preview`, `/imports` | `contacts.import` |
| POST | `/imports/:id/confirm` / `/cancel` | `contacts.import` |
| POST | `/imports/upload-url` | `contacts.import`. `{mimeType, sizeBytes, filename?}` → presigned PUT (CSV ≤ 50 MB) |
| GET | `/imports/:id/error-report` | `contacts.import`. Download URL of the error CSV |
| POST | `/segments/:id/count` | `contacts.read`. Live count; refreshes `cachedCount` |
| GET / PATCH | `/workspace/consent-settings` | `workspace.read` / `workspace.manage`. Opt-out and opt-in keywords and the reply text |
| POST | `/exports` | `contacts.export`. `{filter, q?}` |
| GET | `/exports/:id` | `contacts.export`. Includes a download URL when complete. |

Implementation notes (Phase 6): search uses an opaque offset cursor, `limit` ≤ 200, and a quick search `q` over name, email, WhatsApp name and phone digits. Sorting is by `createdAt`, `name` or `lastInboundAt`. `POST /contacts` normalizes the phone with the workspace country and returns 422 `INVALID_PHONE` with a reason, or 409 if the number exists (`details.contactId`). Consents on create need a `source` (`MANUAL`, `FORM` or `API`). Bulk actions take `contactIds` (≤ 1,000) or a `filter` (≤ 100,000). A bulk delete writes one audit entry. `POST /exports` answers 202, and the job's download URL is valid for 5 minutes.

### Templates (P8)

| Method | Path | P |
| --- | --- | --- |
| GET | `/templates` | `templates.read`. Filters: `status, category, language, wabaId` |
| GET | `/templates/approved` | `templates.read`. For pickers. |
| POST | `/templates` | `templates.write` |
| GET / PATCH / DELETE | `/templates/:id` | read / write (draft only) / write |
| GET | `/templates/:id/versions` | read |
| POST | `/templates/:id/versions` | write. New draft from the latest version. |
| POST | `/templates/:id/submit` **IK** | `templates.submit` |
| POST | `/templates/sync` | `templates.write`. Imports from Meta. |
| POST | `/templates/validate` | read. Dry-run validation. |
| GET | `/templates/accounts` | read. WABAs with a live number (the builder's account picker) |
| POST | `/templates/samples/upload-url`, `/templates/samples/:fileId/complete` | write. Header sample upload (JPEG/PNG ≤ 5 MB, MP4 ≤ 16 MB, PDF ≤ 100 MB; magic bytes checked) |
| GET | `/templates/samples/:fileId/url` | read. Presigned download for previews |

Implemented in Phase 8. `GET /templates/approved?phoneNumberId=` lists the APPROVED version Meta serves for each template of that number's WABA (paused and disabled templates are left out). `POST /templates/validate` returns `{valid, errors[], warnings[]}` from the shared `validateTemplate` plus the server-only checks (name taken, sample file); a submit with errors is 422 `TEMPLATE_INVALID` with the same list in `details.errors`. `PATCH` edits only a DRAFT (409 `TEMPLATE_NOT_EDITABLE` otherwise; name and language are fixed once submitted). `POST /:id/versions` copies the current version into version N+1 (409 while Meta is reviewing). `POST /:id/submit` **IK**: 200 with the template (PENDING, or REJECTED with Meta's reason when Meta refuses the content); a transport, rate-limit or token failure is 503 `UPSTREAM_UNAVAILABLE` and the version stays DRAFT with `lastError`. A name clash is 409 `TEMPLATE_NAME_TAKEN`. `DELETE` deletes the name at Meta (every language) and in Fenwira. `POST /templates/sync` returns `{wabaId, imported, updated, missing}` per WABA.

### Campaigns (P9)

| Method | Path | P |
| --- | --- | --- |
| GET / POST | `/campaigns` | read / `campaigns.write` |
| GET / PATCH / DELETE | `/campaigns/:id` | read / write (DRAFT/SCHEDULED) / write |
| POST | `/campaigns/:id/estimate` | read. Audience count, skips by reason, cost. |
| POST | `/campaigns/:id/launch` **IK** | `campaigns.launch` |
| POST | `/campaigns/:id/pause` · `/resume` · `/stop` · `/retry-failed` | `campaigns.launch` |
| GET | `/campaigns/:id/stats` | read |
| GET | `/campaigns/:id/recipients` | read. Filters: status, skipReason. |
| POST | `/campaigns/:id/recipients/export` | `contacts.export` |

Implemented in Phase 9:

- `POST /campaigns` creates a DRAFT (`name`, `phoneNumberId`, `templateVersionId`, `audience`, `variableMapping`, `scheduleAt` in UTC, `rateLimitPerMinute`). `PATCH`/`DELETE` apply only to DRAFT (409 `CAMPAIGN_INVALID_STATE`).
- `POST /:id/estimate` returns total, sendable, skipped counts per reason, estimated cost, available funds (when enforced), rendered samples and warnings.
- `POST /:id/launch` **IK** → SCHEDULED or PREPARING; 422 `CAMPAIGN_NOT_READY` with `details.problems` (number, template, mapping, audience).
- `POST /:id/unschedule`, `/pause`, `/resume` (422 `INSUFFICIENT_BALANCE` or `CAMPAIGN_NOT_READY` when what paused it still holds) and `/cancel`.
- `GET /:id/stats` and `GET /:id/recipients?status=&skipReason=&cursor=`. `POST /:id/recipients/export` streams CSV (`contacts.export`). "Stop" is "cancel"; "retry-failed" is not built.
- `GET /billing/wallet` (`billing.read`) returns `{currency, balanceMinor, creditLimitMinor, reservedMinor, availableMinor, enforced, billingMode}`; Phase 11 adds `state`, `lowBalanceThresholdMinor` and `spentThisMonthMinor` (below).

### Automation (P10)

| Method | Path | P |
| --- | --- | --- |
| GET / POST | `/flows` | read / `automations.write` |
| GET / PATCH / DELETE | `/flows/:id` | read / write / write |
| GET / PUT | `/flows/:id/draft` | read / write (the graph JSON, `If-Match`) |
| POST | `/flows/:id/validate` | read |
| POST | `/flows/:id/publish` **IK** | `automations.publish` |
| POST | `/flows/:id/pause` / `/resume` | `automations.publish` |
| GET | `/flows/:id/versions` | read |
| POST | `/flows/:id/webhook-token` | `automations.write`. Rotates the token and returns it once. |
| GET | `/flows/:id/executions`, `/executions/:id` (with steps) | read |
| POST | `/executions/:id/cancel` | `automations.publish` |
| GET | `/flows/:id/versions/:versionId` | read (the pinned graph, for "show on canvas") |
| GET | `/flows/:id/trigger-runs/:runId` | read (the ordered plan for one event, with each flow's outcome) |
| POST | `/webhooks/automation/:token` | Public. `X-Fenwira-Signature: sha256=<hex HMAC-SHA256(secret, raw body)>`; optional `Idempotency-Key` (the same key returns the same execution). 202 `{executionId, triggerRunId, status}`; 401 bad signature; 404 unknown token; 409 `FLOW_INVALID_STATE` when the flow isn't active; 422 `INVALID_PHONE`. |

Implemented in Phase 10:
- `GET /flows/:id/draft` returns the draft (or the active version when there is none) with `etag` (also the `ETag` header). `PUT /flows/:id/draft {graph}` requires `If-Match: <etag>`: missing → 400, stale → 409 `VERSION_CONFLICT`. Drafts may hold incomplete step settings; the response carries `validation {valid, errors[{code, message, nodeId?, edgeId?}]}`. The first save after publishing creates a new DRAFT version.
- `POST /flows/:id/publish` → 422 `FLOW_INVALID` with `details.errors` (the shared validator plus server reference checks), 403 `ENTITLEMENT_REQUIRED` (P10-D3), 409 `FLOW_INVALID_STATE` with nothing to publish.
- `/pause` and `/resume` → 409 `FLOW_INVALID_STATE` from the wrong status. `DELETE /flows/:id` archives: no new runs, running ones finish, the webhook token stops working.
- `GET /executions/:id` includes `steps`; viewers without `automations.write` get customer data in step input/output redacted.
- Realtime: `automation.execution.updated {executionId, flowId, status}` to `tenant:{id}`.

### Billing, analytics, developer (P11)

| Method | Path | P |
| --- | --- | --- |
| GET | `/billing/wallet`, `/billing/wallet/transactions` | `billing.read` |
| GET | `/workspace/status` | `workspace.read` (every role). `{wallet: {state, currency, availableMinor}, subscription: {status, trialEndsAt, trialDaysLeft}}`; `availableMinor` is null without `billing.read` |
| GET | `/billing/plans` | `billing.read` (Phase 11 Step 4) |
| GET | `/billing/subscription` | `billing.read` |
| GET | `/billing/entitlements` | `workspace.read` |
| POST | `/billing/subscription/request` | `billing.manage` |
| POST | `/billing/subscription/cancel` | `billing.manage` |
| POST | `/billing/wallet/transactions/export` | `billing.read`. CSV |
| GET | `/analytics/overview`, `/analytics/messaging`, `/analytics/campaigns`, `/analytics/inbox`, `/analytics/automations` | `analytics.read`. `?from&to` or `?days`, `compare` (Phase 11 Step 2, `ANALYTICS.md` → API) |
| GET | `/analytics/usage` | `billing.read` (money) |
| GET | `/contacts/:id/campaigns` | `campaigns.read`. Contact → Campaigns, cursor-paged |
| GET, POST | `/api-keys` | `integrations.manage` |
| DELETE | `/api-keys/:id` | `integrations.manage` |
| GET, POST, PATCH, DELETE | `/webhook-endpoints`, `/webhook-endpoints/:id` | `integrations.manage` |
| POST | `/webhook-endpoints/:id/rotate-secret`, `/webhook-endpoints/:id/test` | `integrations.manage` |
| GET | `/webhook-endpoints/:id/deliveries`, `/webhook-endpoints/:id/deliveries/:deliveryId` | `integrations.manage` |
| POST | `/webhook-endpoints/:id/deliveries/:deliveryId/retry` | `integrations.manage` |

Billing Usage is the web redirect `/billing/usage` → `/analytics/usage`; no separate `/billing/usage` HTTP API exists. Plans are requested via `/billing/subscription/request` and activated through platform subscription operations. Funding uses platform wallet operations; no tenant wallet-credit mutation is exposed.

Implemented in Phase 11 Step 1 (`BILLING.md` → Wallet state, Transactions API):
- `GET /billing/wallet` adds `support {email, url}` (P11-D20, null when not configured), `state` (`NORMAL`, `LOW_BALANCE`, `INSUFFICIENT_FUNDS`, `NOT_ENFORCED`, decision P11-D12), `lowBalanceThresholdMinor` and `spentThisMonthMinor` (usage debits since the 1st, UTC). Clients render `state`; they never compare amounts.
- `GET /workspace/status` for the shell and dashboard.
- `GET /billing/wallet/transactions?type=CREDIT|DEBIT|ADJUSTMENT|REFUND&from&to&cursor&limit` → `{data: [{id, type, fundType, amountMinor, balanceAfterMinor, currency, reason, referenceType, referenceId, expiresAt, createdAt}], page}`.
- `POST /billing/wallet/transactions/export {type?, from?, to?}` → `text/csv`; 422 `EXPORT_TOO_LARGE` above 50 000 rows.

Phase 11 Step 4 (plans and subscriptions, `docs/BILLING.md` → Subscription):

- `GET /billing/plans` → `{data: [{id, key, name, price: {amountMinor, currency, interval} | null, entitlements: {key: boolean | number | null}}]}`. Public plans in `sort` order. `price` is null until prices are approved (P11-D4); the UI shows "Contact us".
- `GET /billing/subscription` → `{data: {status: TRIALING|ACTIVE|EXPIRED|CANCELLED, plan, requestedPlan, requestedAt, interval, trialEndsAt, trialDaysLeft, currentPeriodEnd, cancelAtPeriodEnd}}` (`plan`/`requestedPlan` are `{id, key, name}` or null). A workspace without a row reports the trial it is entitled to.
- `GET /billing/entitlements` → `{data: [{key, label, kind: capability|limit, enabled, limit, usage, overLimit}]}`. `limit` null = unlimited.
- `POST /billing/subscription/request {planId}` → the subscription. Records the request and alerts the operator (`subscription.plan_requested`); it does not change entitlements (P11-D24). 404 for an unknown or non-public plan.
- `POST /billing/subscription/cancel` → the subscription with `cancelAtPeriodEnd: true`. 409 when there is no ACTIVE subscription.
- Errors: 422 `LIMIT_EXCEEDED {key, limit, current}` on user-initiated growth past a limit; 403 `ENTITLEMENT_REQUIRED {key}` for a capability the plan lacks; 422 `SUBSCRIPTION_INACTIVE` for template sends after expiry or cancellation. Inbound is never refused.
- `GET /api-keys` and `GET /webhook-endpoints` add `meta.entitled` (false = suspended by plan; records are kept).

Implemented in Phase 11 Step 3 (`docs/API_KEYS.md`, `docs/WEBHOOKS.md`): tenant API keys and outbound webhooks, both `integrations.manage`-only (never reachable by an API key — a key can never create or manage other keys or webhook endpoints). A separate, fixed subset of `/api/v1` is also reachable with `Authorization: Bearer fw_<prefix>_<secret>` instead of a session cookie — the public API route allowlist in `docs/API_KEYS.md`. Non-allowlisted routes answer `404`, never `403`, to a key.

Implemented in Phase 11 Step 2 (`ANALYTICS.md`): the six analytics views share the range contract (`from`/`to` workspace-local days, or `days`; `compare`) and return `meta {range, previous, timezone, today, partial, retention, freshness}`. Validation errors (from after to, more than 366 days) are 400 `VALIDATION_FAILED`. Daily granularity only; `/analytics/messages` and `/analytics/agents` from the draft became `/analytics/messaging` and `/analytics/inbox`. The Overview's charge is null without `billing.read`.

Implemented in Phase 7: `GET /conversations` takes `view=mine|unassigned|all|takeover|resolved` plus `status, assigneeId, tagId, unread, window, phoneNumberId, q` and `sort=recent|oldest_waiting`, and each item carries `assignee`, `tags`, `automationState`, `unreadCount`, `serviceWindow {expiresAt, isOpen}`, `snoozedUntil`, `firstResponseAt` and, for searches, `snippet`. `POST /conversations/:id/assign` takes `{assigneeId | null}`: claiming for yourself needs `inbox.assign_self`, assigning someone else needs `inbox.reassign`, and the assignee can always unassign themselves. `POST /conversations/:id/compose-lock` takes `{force?}`; a force by anyone other than the assignee or an `inbox.reassign` holder is 409 `COMPOSE_LOCKED`. Replies: 409 `COMPOSE_LOCKED`, and automation sends during a takeover get 422 `AUTOMATION_BLOCKED_BY_TAKEOVER`. Notes take `{body, mentions?: userId[]}`; each mentioned ACTIVE member gets a notification. Visibility `ASSIGNED_ONLY` limits the AGENT role to its own and unassigned conversations; others get 404.

WS events added in Phase 7: `conversation.assigned`, `compose.lock`, `presence.updated`, `note.created` (tenant or conversation rooms, as applicable) and `notification.created` (the `user:{id}` room). Client → server: `compose.heartbeat {conversationId}`, `presence.heartbeat {status?}`.

### WebSocket

See `ARCHITECTURE.md` → Realtime. Payload schemas are in `packages/contracts/src/ws`.

## Open questions

None. Resolved in the specification freeze (2026-09-26); see `PRODUCT.md` → Decision register.

## Platform authentication (Step 5)

Never public-API-key routes. `POST /platform/auth/login {email,password}` returns `{challengeToken}`; `POST /platform/auth/verify {challengeToken,code}` sets platform cookies and returns `{csrfToken,expiresAt}`. `GET /platform/auth/me` returns operator ID, separate permission catalog, expiration and platform CSRF token. `POST /platform/auth/reauth {password,code}` refreshes MFA assurance only; `POST /platform/auth/logout` revokes privilege (204). Login/verify enforce origin and rate limits; all other mutations require platform CSRF. No membership/tenant header needed.

## Platform commercial reads (Step 5)

All require platform-session cookies, never tenant/API-key authorization. `GET /platform/workspaces?q=...&limit=20` searches bounded identities (2–120 characters, max 50). `GET /platform/workspaces/:workspaceId` returns a commercial snapshot, fingerprint, configured/enforced entitlements and over-limit state, grants issued, recent ledger/operation activity and reconciliation checks. `GET /platform/workspaces/:workspaceId/financial` (`financial.read`) returns recorded customer/provider totals, known-cost coverage/contribution and current tax metadata. Unknown provider costs remain null; historic placeholder provenance is unavailable. `GET /platform/workspaces/:workspaceId/operations` (`audit.read`) returns up to 100 immutable receipts; `GET /platform/audit` returns up to 100 platform security/access events. Bounds prevent unbounded exports. Conflicting X-Tenant-Id is rejected. Customer message/conversation content is excluded.

`POST /platform/workspaces/:workspaceId/wallet-operations` (`wallet.manage`, fresh MFA) accepts `{kind: paid_credit|promotional_credit|adjustment|refund, amountMinor, currency: INR, reason, reference, idempotencyKey, expectedVersion?}`. Promotional grants may include future `expiresAt` metadata; refunds require `debitId`. Positive credit/refund amounts, nonzero signed adjustments. Negative adjustments preserve nonnegative available funds after reservations; cumulative refunds cannot exceed the original debit. Returns the immutable receipt. Identical replay returns the original; changed payload 409; out-of-workspace debit 404; invalid financial effect 422. Successful receipt emits `commercial.operation_completed` transactionally, deduplicated billing-reader notification.

Platform POST `/platform/workspaces/:workspaceId/subscription-operations` (`subscription.manage`): activate configured planId, cancel at period-end, billing_mode FREE/TRIAL/PREPAID. POST `entitlement-operations` (`entitlements.manage`): typed override_set/override_remove. Shared contracts require commercial metadata and accept expectedVersion; retries replay immutable receipts.

### Invoices (ADR-0027 manual UPI billing)

Tenant routes under `/billing/invoices`: `billing.read` for GETs, `billing.manage` (OWNER) to submit proof. Another workspace's invoice is 404. See BILLING.md → Manual invoices.

| Method | Path | Body → result |
| --- | --- | --- |
| GET | `/billing/invoices` | → `Invoice[]` (newest first, at most 100) with `displayStatus` and `proofs[]` |
| GET | `/billing/invoices/:id` | → `InvoiceDetail` = `Invoice` + `upi {deepLink, qrDataUrl}` while OPEN |
| GET | `/billing/invoices/:id/document` | Payment request as self-contained HTML (`?download=1` → attachment); strict CSP |
| GET | `/billing/invoices/:id/receipt` | Receipt HTML; 409 `INVOICE_NOT_OPEN` unless PAID |
| POST | `/billing/invoices/:id/proof-uploads` | `{filename, mimeType: image/png\|image/jpeg\|application/pdf, sizeBytes ≤ 5 MB}` → 201 `{fileId, url, headers, expiresAt}` (presigned PUT) |
| POST | `/billing/invoices/:id/proofs` | `{utr, fileId?}` → 201 `InvoiceDetail`. 409 `UTR_ALREADY_USED` (any workspace), `PAYMENT_PENDING`, `INVOICE_NOT_OPEN`; 422 for an invalid file |

Rate limits per workspace: proof uploads 30/h, proofs 20/h. `GET /workspace/status` → `subscription` adds `paymentDue` and `graceEndsAt`. Subscription statuses add `PAST_DUE` and `SUSPENDED`. Sends from a SUSPENDED workspace return 422 `SUBSCRIPTION_SUSPENDED` (SYSTEM sends excepted), as do campaign launch and resume.

### Platform billing (ADR-0027)

Platform session only. `payments.read` for GETs; `payments.manage` plus fresh MFA and platform CSRF for writes. Writes are commercial operations with immutable receipts.

| Method | Path | Body → result |
| --- | --- | --- |
| GET | `/platform/billing/dashboard` | → `{pending[], overdue[], revenue[]}` |
| GET | `/platform/workspaces/:workspaceId/invoices` | → `PlatformInvoice[]` (amounts as strings) |
| POST | `/platform/workspaces/:workspaceId/invoices` | `{kind, amountMinor, planKey?, description?, dueAt, idempotencyKey}` → 201 receipt (`result.invoiceId`). 409 `INVOICE_ALREADY_OPEN` (renewal); 422 `UPI_NOT_CONFIGURED` |
| POST | `/platform/workspaces/:workspaceId/invoices/:invoiceId/void` | `{reason}` → receipt; 409 `PAYMENT_PENDING` / `INVOICE_NOT_OPEN` |
| GET | `/platform/workspaces/:workspaceId/payment-proofs/:proofId/file` | → `{url, mimeType, expiresAt}` (2 minutes; audited) |
| POST | `/platform/workspaces/:workspaceId/payment-proofs/:proofId/approve` | `{reference, note?}` → `{proofId, status, invoiceStatus, receiptNumber, operationId}`; idempotent; 409 `ALREADY_REVIEWED` |
| POST | `/platform/workspaces/:workspaceId/payment-proofs/:proofId/reject` | `{reason}` → same shape |

### Platform accounts (ADR-0027 step 4: onboarding without email)

| Method | Path | Permission | Body → result |
| --- | --- | --- | --- |
| POST | `/platform/workspaces/provision` | `workspaces.manage` + fresh MFA | `{workspaceName, ownerName, ownerEmail, country?, timezone?}` → 201 `{workspaceId, ownerUserId, setupLink, setupExpiresAt}`. The setup link (72 h, single use) sets the first password and verifies the email (ML-D7). It is `null` when the email already has an account |
| GET | `/platform/workspaces/:workspaceId/members` | `commercial.read` | → `[{userId, name, email, role, status, emailVerified, joinedAt}]` |
| POST | `/platform/workspaces/:workspaceId/members/:userId/reset-link` | `workspaces.manage` + fresh MFA | → `{link, expiresAt}` (1 h, single use; ML-D4: operators only; members of that workspace only) |
| GET | `/platform/plans` | `commercial.read` | → `[{key, name, monthly: {currency, amountMinor} \| null}]` |
| POST | `/platform/plans/:planKey/price` | `subscription.manage` + fresh MFA | `{currency: 'INR', amountMinor}` (₹1–₹10,00,000) → the plan. Audited `platform.plan_price_set`; affects invoices issued afterwards |
| GET | `/platform/access-requests` | `commercial.read` | → the last 200 Request access leads, newest first: `{id, name, company, email, phone, volume, status: QUEUED\|EMAILED\|EMAIL_FAILED\|EMAIL_SKIPPED, createdAt}` |
| GET | `/platform/email-deliveries` | `audit.read` | → the last 100 emails: `{kind, status: SENT\|FAILED\|SKIPPED_NO_SMTP\|SUPPRESSED, recipientHint, errorCode}` |

Tenant: `POST /team/invitations` now returns `link` (72 h, single use; the email carries the same link when SMTP is configured). `POST /team/invitations/:id/resend` returns `{data: {link, expiresAt}}`, and the previous link stops working. Links are shown once; only their SHA-256 is stored. Seat (`max_users`) and WhatsApp number (`max_phone_numbers`) limits come from the entitlements (422 `LIMIT_EXCEEDED`).

### Public (marketing site). No auth, no cookies.

| Method | Path | Body → result |
| --- | --- | --- |
| POST | `/public/request-access` | `{name, company, email, phone, volume, website?}` (strict; `volume` is one of `ACCESS_REQUEST_VOLUMES`) → 200 `{received: true}`. 400 on validation, 429 `RATE_LIMITED` after 5 per IP per hour (200 per hour overall). `website` is a honeypot: a non-empty value answers the same 200 and stores nothing. The lead (`access_requests`) and its outbox event commit together; the worker emails fenwira@zenteqk.com from MAIL_FROM with Reply-To the visitor, and records the outcome on the lead and in `email_deliveries` |

CORS for `/public/*` allows only `PUBLIC_SITE_ORIGINS` (default `https://fenwira.com,https://www.fenwira.com`), POST, `Content-Type`, no credentials. `@PublicSite()` makes the CSRF guard accept only those origins (or none) on these routes; every other route keeps `WEB_ORIGIN`.

### Platform WhatsApp (ADR-0027 Managed Launch Mode)

Under `/platform/workspaces/:workspaceId/whatsapp`, platform session only (`whatsapp.read` for GETs; `whatsapp.manage` plus fresh MFA and platform CSRF for the rest). An unknown or deleted workspace, and a connection of another workspace, are 404. Every mutation writes a tenant audit entry (actor `PLATFORM_OPERATOR`) and a `platform_audit` row (`platform.whatsapp.*`, SUCCESS/FAILED). Responses carry `PlatformWhatsAppConnection` (the tenant connection plus `metaAppId`, `businessId`, `appSecret {maskedSecret, rotatedAt}`, `templatesSyncedAt`); no token or secret is ever returned.

| Method | Path | Body → result |
| --- | --- | --- |
| GET | `/connections` | → `PlatformWhatsAppConnection[]` |
| GET | `/connections/:id` | → `PlatformWhatsAppConnection` |
| POST | `/connections` | `{wabaId, phoneNumberId, displayPhoneNumber, accessToken, appSecret?, appId?, businessId?}` → 201. 422 `WHATSAPP_CONNECT_FAILED {step, steps}` before anything is stored; 409 `PHONE_NUMBER_ALREADY_CONNECTED` |
| POST | `/connections/:id/verify` | → `{ok, verifiedAt, checks: {token, phoneNumber, waba}}`; stored on the credential (`verifiedAt`, `verifyOk`, `verifyErrorCode`); a rejected token becomes INVALID |
| POST | `/connections/:id/subscribe` | Re-subscribes the app to the WABA's webhooks |
| POST | `/connections/:id/sync` | Status, quality rating and messaging limit from Meta |
| POST | `/connections/:id/sync-templates` | → `{syncedAt, imported, updated, missing}` |
| POST | `/connections/:id/rotate` | `{accessToken?, appSecret?, appId?}` (at least one); a new token is verified first |
| DELETE | `/connections/:id` | 204; unsubscribes and wipes the token and app secret (when no other live number uses the WABA) |

Rate limits per workspace: connect/rotate 20/h, verify 30/h, sync 30/h, template sync 30/h. Tenant `GET /whatsapp/connections` now also returns `connectionMode` and `credential.{verifiedAt, verifyOk, verifyErrorCode}`.

Platform POST `wallet-preview`, `subscription-preview`, `entitlement-preview` under `/platform/workspaces/:workspaceId` use the same corresponding permission/request contract. Domain calculations and validation run in a transaction that always rolls back; no receipt, ledger, subscription, override or outbox change persists. A separate immutable preview-access event is recorded. Preview returns version, before/after/result and effective configured entitlements. Confirmation submits expectedVersion; stale state is 409 VERSION_CONFLICT.

## Phase 11 closure verification

[Phase 11 closure evidence](plans/PHASE_11_CLOSURE.md) exercises platform MFA, shared commercial operations and tenant financial allowlists against the real API. Closure adds no endpoint or public API scope.

## Native connectors (Experience V2 follow-up)

The private, cookie-session API under `/api/v1/native-connectors` requires `integrations.manage`, tenant membership and normal mutation CSRF protection. It has no `@PublicApi` routes; API keys cannot access it. Contracts live in `packages/contracts/src/api/native-connectors.ts`.

| Method / relative path | Behavior |
| --- | --- |
| GET `/native-connectors` | Four-provider catalog, configuration availability and safe connection summaries |
| POST `/native-connectors/connect` | Verify ERPNext key/secret, or issue a ten-minute, user/session/workspace-bound OAuth challenge and authorization URL |
| POST `/native-connectors/oauth/complete` | Consume one challenge and exchange the authorization code server-side; Shopify additionally verifies callback HMAC/store/time |
| DELETE `/native-connectors/:id` | Remove local credentials, preserve imported contacts and transfer history |
| GET `/native-connectors/:id/transfers` | Latest 20 tenant-scoped transfer receipts; no secrets or contact payloads |
| POST `/native-connectors/:id/transfers` | Create a durable transfer and outbox intent, returning 202; requires `contacts.import` or `contacts.export` according to direction |
| POST `/native-connectors/:id/transfers/:transferId/retry` | Requeue failed/stale work using the same snapshot/receipt; requires the same directional permission |

Transfer idempotency keys are UUIDs, scoped to workspace and bound to connection/destination. A mismatched reuse returns 409. Only one PENDING transfer per connection is permitted. Imports prepare a private CSV and the existing Contacts mapping/preview/confirmation workflow; successful preparation does not mean contacts have already been imported. Google Sheets requires a spreadsheet ID and `confirmExport: true`; each receipt creates a distinct dedicated tab. Limits are 10,000 records per transfer; excess data fails explicitly rather than silently truncating it.

Provider credentials, OAuth verifier/code/token data and contact snapshots never appear in list/receipt DTOs. See [native connector specification](NATIVE_CONNECTORS.md) for configuration and live acceptance requirements.

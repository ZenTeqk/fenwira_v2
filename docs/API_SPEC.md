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
| `Authorization: Bearer fw_live_…` | API key (alternative to cookies) |
| `X-Tenant-Id` | Required on tenant-scoped routes for cookie auth. Ignored for API keys. |
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
| 422 | Domain rule violations: `CONVERSATION_WINDOW_CLOSED`, `CONSENT_REQUIRED`, `CONTACT_BLOCKED`, `INVALID_PHONE`, `AUTOMATION_BLOCKED_BY_TAKEOVER`, `NO_CONNECTED_NUMBER`, `TEMPLATE_NOT_APPROVED`, `TEMPLATE_VARIABLES_INVALID`, `TEMPLATE_*` (validation codes in `TEMPLATE_ENGINE.md`), `FLOW_*` (validation codes in `AUTOMATION_ENGINE.md`), `LIMIT_EXCEEDED`, `INSUFFICIENT_BALANCE`, `SUBSCRIPTION_INACTIVE` |
| 429 | `RATE_LIMITED` (+ `Retry-After`) |
| 5xx | `INTERNAL`, `UPSTREAM_UNAVAILABLE` (503: Redis or Postgres unreachable — a dependency outage, not a bug) |

Error codes are a closed enum in `packages/contracts/src/errors.ts`, and the web app maps them to user copy.

### Idempotency

- `Idempotency-Key`: 8–128 characters, unique per `(tenant, scope)` for 24 hours.
- First request: the key row is locked, the handler runs, and the status and body are stored.
- Replay with the same body hash returns the stored response. With a different body it returns 409 `IDEMPOTENCY_KEY_REUSED`. While the first request is still running, it returns 409 `IDEMPOTENCY_IN_PROGRESS`.

### Concurrency

Mutable aggregates edited in forms (contacts, templates drafts, campaigns drafts, flow drafts) return `updatedAt`. Updates send `If-Match: "<updatedAt>"`, and a stale value returns 409 `VERSION_CONFLICT`.

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
| GET | `/auth/me` | Session | → `{data: {user, memberships: [{membershipId, tenantId, tenantName, tenantSlug, role, permissions[], require2fa}], csrfToken}}` |
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
| DELETE | `/workspace` | OWNER | Soft delete, 204 |
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
| GET | `/config/whatsapp-signup` | `whatsapp.manage`. `{appId, configId, graphVersion}` (all public values) |

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
| POST | `/messages/:id/retry` | `inbox.reply`. Only for FAILED messages with a retryable error. |

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
| GET / POST | `/contacts/:id/notes` | read / write |
| CRUD | `/contact-properties` | read / `contacts.properties.manage` |
| CRUD | `/tags` | read / `contacts.write` |
| CRUD | `/segments` | read / `contacts.write` |
| POST | `/imports` | `contacts.import`. `{fileId}` → job (parses headers, suggests a mapping) |
| PATCH | `/imports/:id` | `{columnMapping, duplicatePolicy, defaultConsent}` → validate |
| GET | `/imports/:id`, `/imports/:id/preview`, `/imports` | `contacts.import` |
| POST | `/imports/:id/confirm` / `/cancel` | `contacts.import` |
| POST | `/exports` | `contacts.export`. `{filter}` |
| GET | `/exports/:id` | `contacts.export`. Includes a download URL when complete. |

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

### Billing, analytics, developer (P11)

| Method | Path | P |
| --- | --- | --- |
| GET | `/billing/subscription`, `/billing/plans`, `/billing/entitlements` | `billing.read` |
| POST | `/billing/subscription/change` | `billing.manage` (admin-driven in v2) |
| GET | `/billing/wallet`, `/billing/wallet/transactions`, `/billing/usage` | `billing.read` |
| POST | `/billing/wallet/credits` **IK** | Platform admin only in v2 |
| GET | `/analytics/overview`, `/analytics/messages`, `/analytics/campaigns`, `/analytics/agents`, `/analytics/automations`, `/analytics/usage` | `analytics.read`. `?from&to&granularity` |
| CRUD | `/api-keys` | `integrations.manage` |
| CRUD | `/webhook-endpoints`, GET `/webhook-endpoints/:id/deliveries`, POST `…/test` | `integrations.manage` |

### WebSocket

See `ARCHITECTURE.md` → Realtime. Payload schemas are in `packages/contracts/src/ws`.

## Open questions

| # | Question | Owner |
| --- | --- | --- |
| API1 | Should we publish an OpenAPI document for the public API (generated from Zod via `zod-openapi`) in Phase 11? Assumed yes. | Eng |

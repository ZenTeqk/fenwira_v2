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
| `X-CSRF-Token` | Required on cookie-authenticated mutations |
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
| 404 | `NOT_FOUND`, `TENANT_NOT_FOUND` (also used for tenants you don't belong to) |
| 409 | `CONFLICT`, `IDEMPOTENCY_KEY_REUSED` (different body), `IDEMPOTENCY_IN_PROGRESS`, `COMPOSE_LOCKED`, `VERSION_CONFLICT`, `PHONE_NUMBER_ALREADY_CONNECTED` |
| 422 | Domain rule violations: `CONVERSATION_WINDOW_CLOSED`, `CONSENT_REQUIRED`, `CONTACT_BLOCKED`, `INVALID_PHONE`, `AUTOMATION_BLOCKED_BY_TAKEOVER`, `NO_CONNECTED_NUMBER`, `TEMPLATE_NOT_APPROVED`, `TEMPLATE_VARIABLES_INVALID`, `TEMPLATE_*` (validation codes in `TEMPLATE_ENGINE.md`), `FLOW_*` (validation codes in `AUTOMATION_ENGINE.md`), `LIMIT_EXCEEDED`, `INSUFFICIENT_BALANCE`, `SUBSCRIPTION_INACTIVE` |
| 429 | `RATE_LIMITED` (+ `Retry-After`) |
| 5xx | `INTERNAL`, `UPSTREAM_UNAVAILABLE` |

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

### Auth & identity (P3). No tenant header.

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/auth/register` | `{name, email, password}` → sends a verification email |
| POST | `/auth/email/verify` | `{token}` |
| POST | `/auth/email/resend` | |
| POST | `/auth/login` | → 200 plus cookies, or 202 `{challenge:'TOTP', challengeToken}` |
| POST | `/auth/2fa/verify` | `{challengeToken, code}` (TOTP or backup code) |
| POST | `/auth/refresh` | Rotates `fw_rt` |
| POST | `/auth/logout` | |
| POST | `/auth/password/forgot` / `/auth/password/reset` | |
| GET | `/auth/me` | User plus memberships `[{tenant, role, permissions}]` |
| PATCH | `/me` | Name, locale, timezone, avatar |
| POST | `/me/password` | Revokes other sessions |
| GET / DELETE | `/me/sessions`, `/me/sessions/:id` | List and revoke |
| POST | `/me/2fa/setup` → `/me/2fa/enable` → `/me/2fa/disable` | Setup returns an otpauth URI. Enable returns the backup codes. |
| POST | `/tenants` | Create a workspace. The caller becomes OWNER. |
| GET | `/invitations/:token` | Public preview (workspace name, inviter) |
| POST | `/invitations/:token/accept` | Existing user, or `{name, password}` for a new user |

### Workspace, team, audit (P3). Tenant-scoped.

| Method | Path | P |
| --- | --- | --- |
| GET / PATCH | `/workspace` | `workspace.read` / `workspace.manage` |
| DELETE | `/workspace` | OWNER |
| POST | `/workspace/transfer-ownership` | OWNER |
| GET | `/team/members` | `team.read` |
| PATCH | `/team/members/:membershipId` | `team.manage` (role) |
| POST | `/team/members/:membershipId/deactivate` / `/reactivate` | `team.manage` |
| GET / POST | `/team/invitations` | `team.manage` |
| POST | `/team/invitations/:id/resend` / `/revoke` | `team.manage` |
| GET | `/roles` | `roles.read` (matrix) |
| GET | `/audit-logs` | `audit.view` (filter: actor, action, target, date) |
| GET / POST | `/notifications`, `/notifications/:id/read`, `/notifications/read-all` | self (P7) |

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

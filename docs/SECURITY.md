# Security

## Scope

Authentication, sessions, RBAC, secret handling, PII and logging rules, rate limits, input and file safety, and the threat model. Tenant isolation mechanics are in `MULTI_TENANCY.md`.

## Decisions

### Passwords

- Argon2id (`m=19456 KiB, t=2, p=1`, per the OWASP baseline), with parameters stored in the hash string so they can be upgraded on login.
- Policy: at least 10 characters and a max of 128. The password is checked against a bundled top-100k breached-password list (offline). There are no composition rules.
- Login errors are generic (`INVALID_CREDENTIALS`) and take constant time for unknown emails (a dummy hash is verified).

### Sessions

| Item | Value |
| --- | --- |
| Access token | JWT (EdDSA, Ed25519 key from env), 15 min, claims `sub, sid, iat, exp`. It carries **no tenant or role**; those are resolved per request. |
| Refresh token | 256-bit random, stored as a SHA-256 hash in `sessions`, 30-day absolute and 7-day idle lifetime |
| Cookies | `fw_at` (access): HttpOnly, Secure (except in dev over http), SameSite=Lax, Path=/. `fw_rt` (refresh): HttpOnly, Secure, SameSite=Strict, Path=/api/v1/auth. `fw_csrf`: readable, SameSite=Lax. |
| Rotation | Each refresh issues a new refresh token in the same `family_id`. **Reuse of an already-rotated token revokes the whole family** and writes an audit entry. |
| Revocation | Logout revokes the session. "Log out everywhere" revokes all of the user's sessions. A password change revokes all other sessions. |
| Access-token revocation lag | Up to 15 minutes. The `sid` is checked against a Redis deny-set on each request (`revoked_sid:{sid}`, TTL 15 minutes), which removes the lag. |

### CSRF

For cookie-authenticated **mutating** requests: double-submit. The `X-CSRF-Token` header must equal the `fw_csrf` cookie, and the `Origin` header must match `WEB_ORIGIN`. API-key-authenticated requests are exempt because they don't use cookies.

### 2FA (optional per user; tenants can require it, Phase 3)

- TOTP (RFC 6238, SHA-1, 6 digits, 30 s, ±1 step). The secret is encrypted with the app crypto.
- 10 single-use backup codes, Argon2id-hashed.
- Login with 2FA returns `202 {challenge: 'TOTP', challengeToken}` (a 5-minute signed token). `POST /auth/2fa/verify` completes it.
- A tenant setting `require_2fa` makes members without 2FA enroll before they can access that tenant.

### RBAC

Roles are fixed and seeded: `OWNER`, `ADMIN`, `MANAGER`, `AGENT`, `VIEWER`. Guards check **permission keys**, never role names. The only exceptions are OWNER-only actions (ownership transfer, workspace deletion), which are checked with `@RequireRole('OWNER')`.

Permission catalog and matrix (● = granted):

| Permission | OWNER | ADMIN | MANAGER | AGENT | VIEWER |
| --- | :-: | :-: | :-: | :-: | :-: |
| `workspace.read` | ● | ● | ● | ● | ● |
| `workspace.manage` (name, timezone, security settings) | ● | ● | | | |
| `workspace.delete` / `workspace.transfer` | ● | | | | |
| `team.read` | ● | ● | ● | ● | ● |
| `team.manage` (invite, role change, deactivate) | ● | ● | | | |
| `roles.read` | ● | ● | ● | | |
| `whatsapp.read` | ● | ● | ● | ● | ● |
| `whatsapp.manage` | ● | ● | | | |
| `contacts.read` | ● | ● | ● | ● | ● |
| `contacts.write` (create/edit/tag/notes/segments) | ● | ● | ● | ● | |
| `contacts.delete` | ● | ● | ● | | |
| `contacts.import` | ● | ● | ● | | |
| `contacts.export` | ● | ● | ● | | |
| `contacts.properties.manage` | ● | ● | | | |
| `inbox.read` | ● | ● | ● | ● | ● |
| `inbox.reply` | ● | ● | ● | ● | |
| `inbox.assign_self` | ● | ● | ● | ● | |
| `inbox.reassign` | ● | ● | ● | | |
| `inbox.read_all` (see conversations assigned to others) | ● | ● | ● | ● | ● |
| `templates.read` | ● | ● | ● | ● | ● |
| `templates.write` | ● | ● | ● | | |
| `templates.submit` | ● | ● | ● | | |
| `campaigns.read` | ● | ● | ● | ● | ● |
| `campaigns.write` (draft) | ● | ● | ● | | |
| `campaigns.launch` (launch/pause/resume/stop/retry) | ● | ● | ● | | |
| `automations.read` | ● | ● | ● | ● | ● |
| `automations.write` | ● | ● | ● | | |
| `automations.publish` (publish/pause/cancel) | ● | ● | | | |
| `analytics.read` | ● | ● | ● | | ● |
| `billing.read` | ● | ● | | | |
| `billing.manage` | ● | | | | |
| `integrations.manage` (API keys, webhooks) | ● | ● | | | |
| `audit.view` | ● | ● | | | |

- `inbox.read_all` is granted to everyone by default. A tenant setting (`inbox_visibility = ASSIGNED_ONLY`) removes it from AGENT.
- An actor cannot grant a role with a higher `rank` than their own, and cannot change their own role.
- There is exactly one OWNER. Ownership transfer is atomic: the old OWNER becomes ADMIN.

### API keys (Phase 11)

- Format: `fw_live_{prefix8}_{secret32}` (base62). Only `sha256(secret + API_KEY_PEPPER)` is stored. The full key is shown once.
- A key's scopes are a subset of the permission catalog and cannot exceed its creator's permissions at creation time.
- Keys are rate-limited separately from user traffic.

### Secret encryption

- `packages/config/crypto`: AES-256-GCM with a 96-bit random IV. Ciphertext format `v1.{kid}.{iv_b64}.{tag_b64}.{ct_b64}`, stored as `bytea`.
- Keys: `ENCRYPTION_KEYS="k1:base64key,k2:base64key"` and `ENCRYPTION_ACTIVE_KEY_ID=k2`. Decryption picks the key by `kid`. The `system.maintenance` re-encrypt job rewrites old-`kid` rows.
- Applies to: Meta tokens, phone registration PINs, TOTP secrets and tenant webhook signing secrets.
- Decrypted values exist only in memory inside the module that uses them. They never appear in contracts, logs, errors or audit `changes`.

### PII and logging

| Data | May log at info+ | Notes |
| --- | --- | --- |
| IDs (tenant, user, contact, message, correlation) | Yes | |
| Phone number | **No** | Log `contactId`; debug level may log a masked value (`+91•••••••210`) |
| Email | **No** | |
| Message body, template variables, notes | **No** | |
| Tokens, secrets, cookies, `Authorization` | **Never at any level** | pino `redact` paths are configured centrally |
| Meta error code/message | Yes | Meta messages don't contain the message body |

A CI test runs the E2E suite with log capture and greps for known seed phone numbers, emails and token prefixes. It fails if any appear.

### Rate limits (Redis sliding window, `@nestjs/throttler` with Redis storage)

| Surface | Limit |
| --- | --- |
| `POST /auth/login` | 5/min per email + 20/min per IP |
| `POST /auth/register`, `/auth/password/forgot` | 5/hour per IP, 3/hour per email |
| `POST /auth/2fa/verify` | 5 per challenge |
| Authenticated API (user) | 600/min per user per tenant |
| API key | 1,200/min per key (plan-adjustable) |
| `POST /webhooks/whatsapp` | No app limit. Protected by HMAC; the reverse proxy caps body size at 1 MB. |
| Message send endpoints | 60/min per user (the business limit is enforced by the queue limiter) |

Responses include `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset`. A 429 carries `Retry-After`.

### Input, output and file safety

- All input is validated by Zod contracts, and unknown keys are stripped.
- Output: React escapes by default. `dangerouslySetInnerHTML` is forbidden (lint), and message text is rendered as plain text with a URL-linkify only.
- CSP on web: `default-src 'self'`. `connect-src` includes the API and WS origins, plus the MinIO public endpoint for presigned PUTs. `frame-src https://www.facebook.com` (Embedded Signup). No `unsafe-eval` in production.
- Uploads: allow-listed MIME types checked by magic-byte sniffing (`file-type`), not the extension. Size caps: images 5 MB, video 16 MB, audio 16 MB, documents 100 MB (the Meta limits), CSV imports 50 MB. Images are re-encoded (sharp) to strip EXIF and metadata before being used in templates.
- Search and filter: the filter DSL compiles to parameterized Prisma queries only. Raw SQL is limited to `packages/database/sql` and uses tagged templates.
- Outbound HTTP (automation webhook node, tenant webhooks): an SSRF guard blocks private, loopback, link-local and metadata IP ranges after DNS resolution. HTTPS is required except in dev. Timeout 10 s, response cap 1 MB.

### Audit

Audit these actions (non-exhaustive): auth events (login, logout, 2FA changes, password change, session revocation, refresh reuse), membership and role changes, invitations, WhatsApp connection changes, credential rotation, template submission, campaign launch/pause/stop, flow publish/pause, consent manual changes, exports, API key create/revoke, billing changes, and entitlement overrides.

## Threat model (STRIDE summary)

| Threat | Vector | Mitigation |
| --- | --- | --- |
| Spoofing | Forged Meta webhook | HMAC-SHA256 on the raw body with the platform app secret, constant-time compare |
| Spoofing | Stolen session | HttpOnly cookies, refresh rotation with reuse detection, sid deny-set, optional 2FA |
| Tampering | Cross-tenant write | RLS `WITH CHECK`, tenant guard, generated test matrix |
| Repudiation | Admin denies an action | Append-only `audit_logs` with actor, IP and correlation ID |
| Info disclosure | Cross-tenant read, tenant enumeration | RLS, 404 for foreign tenants, IDs-only `system.*` functions |
| Info disclosure | Token leak via API or logs | Encryption, contract exclusion, pino redact, log-grep CI test |
| DoS | Webhook flood | Fast-ack ingest, queue buffering, body cap, horizontal api scaling |
| DoS | Campaign abuse / spam | Consent enforcement, `campaigns.launch` permission, rate limiter, Meta quality monitoring |
| Elevation | Role escalation | Rank check on role changes, permission guards generated from the matrix |
| SSRF | Automation webhook node | IP-range blocklist after DNS resolution, egress timeout and cap |

## Open questions

| # | Question | Owner |
| --- | --- | --- |
| S1 | Is SSO/SAML needed for the Business plan in v2? Assumed no. | Product |
| S2 | Should `require_2fa` be the default for new tenants? Assumed off. | Product |

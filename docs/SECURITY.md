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
| Cookies | `fw_at` (access): HttpOnly, Secure (except in dev over http), SameSite=Lax, Path=/. `fw_rt` (refresh): HttpOnly, Secure, SameSite=Strict, Path=/api/v1/auth. `fw_csrf`: **HttpOnly**, SameSite=Lax; the value reaches the client in response bodies (see Phase 3 notes). |
| Rotation | Each refresh issues a new refresh token in the same `family_id`. **Reuse of an already-rotated token revokes the whole family** and records a `REFRESH_TOKEN_REUSE` security event. |
| Revocation | Logout revokes the session. "Log out everywhere" revokes all of the user's sessions. A password change revokes all other sessions. |
| Access-token revocation lag | Up to 15 minutes. The `sid` is checked against a Redis deny-set on each request (`revoked_sid:{sid}`, TTL 15 minutes), which removes the lag. |

### CSRF

For cookie-authenticated **mutating** requests: double-submit. The `X-CSRF-Token` header must equal the `fw_csrf` cookie, and the `Origin` header must match `WEB_ORIGIN`. API-key-authenticated requests are exempt because they don't use cookies.

### 2FA (optional by default; a workspace can require it, Phase 3)

- TOTP (RFC 6238, SHA-1, 6 digits, 30 s, ±1 step). The secret is encrypted with the app crypto.
- 10 single-use backup codes, Argon2id-hashed.
- Login with 2FA returns `202 {challenge: 'TOTP', challengeToken}` (a 5-minute signed token). `POST /auth/2fa/verify` completes it.
- 2FA is optional by default (decision S2). The workspace setting `require_2fa` (default `false`) makes members without 2FA enroll before they can access that workspace.
- No SSO/SAML in v2 (decision S1).

### RBAC

Roles are fixed and seeded: `OWNER`, `ADMIN`, `MANAGER`, `AGENT`, `VIEWER`. Guards check **permission keys**, never role names. The only exceptions are OWNER-only actions (ownership transfer, workspace deletion and restore), which are checked with `@RequireRole('OWNER')` (restore checks the caller's OWNER membership of the deleted workspace).

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
| `inbox.canned_replies.manage` (create/edit/delete workspace canned replies; using them needs `inbox.reply`) | ● | ● | ● | | |
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

### API keys (Phase 11 Step 3, `docs/API_KEYS.md`)

- Format: `fw_{prefix8}_{secret}` — an 8-character prefix (identification only, no entropy) and a 20–128-character URL-safe secret (256 bits). Only `sha256(pepper:secret)` is stored, verified with a constant-time compare; the full key is shown once, at creation.
- A key's scopes are a fixed public-API catalog (`API_KEY_SCOPES`), never the full permission catalog, and can never exceed its creator's own permissions at creation time.
- A key reaches only routes carrying both `@PublicApi()` and `@RequirePermission(...)`; anything else answers `404`, never `403` — the private surface is never discoverable by probing with a valid key.
- Rate-limited per key (`API_KEY_RATE_LIMIT_PER_MINUTE`, default 120/minute), separately from human-session traffic.
- Revocation is immediate and irreversible; expiry (optional) fails the same generic `401` as a wrong or revoked key, so a caller can never distinguish the two.
- Audited as `actorType: 'API_KEY'`, never attributed to a human.

### Secret encryption

- `packages/config/crypto`: AES-256-GCM with a 96-bit random IV. Ciphertext format `v1.{kid}.{iv_b64}.{tag_b64}.{ct_b64}`, stored as `bytea`.
- Keys: `ENCRYPTION_KEYS="k1:base64key,k2:base64key"` and `ENCRYPTION_ACTIVE_KEY_ID=k2`. Decryption picks the key by `kid`. The `system.maintenance` re-encrypt job rewrites old-`kid` rows.
- Applies to: Meta tokens, phone registration PINs, TOTP secrets and tenant webhook signing secrets.
- Decrypted values exist only in memory inside the module that uses them. They never appear in contracts, logs, errors or audit `changes`.

### Data protection (decision D1)

- Normal message content is **not** encrypted at the application/column level in v2. Production relies on encryption at rest for the database, object storage and backups, and TLS for all traffic in transit.
- Credentials, Meta tokens, secrets and equivalent authentication material are protected separately: encrypted as described above (Secret encryption) or stored as one-way hashes (passwords, API keys, invitation and reset tokens). They never reach the browser, logs, errors or audit entries.

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

### Rate limits (Redis sliding window: `RateLimitService`, a sorted set per key)

| Surface | Limit |
| --- | --- |
| `POST /auth/login` | 5/min per email + 20/min per IP |
| `POST /auth/register`, `/auth/password/forgot` | 5/hour per IP, 3/hour per email |
| `POST /auth/2fa/verify` | 5 per challenge |
| Authenticated API (user) | 600/min per user per tenant |
| API key | 1,200/min per key (plan-adjustable) |
| `POST /webhooks/whatsapp` | No app limit. Protected by HMAC; the reverse proxy caps body size at 1 MB. |
| Message send endpoints | 60/min per user (the business limit is enforced by the queue limiter) |

A 429 carries `Retry-After`.

**Implemented in Phase 3:**

| Surface | Limit |
| --- | --- |
| Login | 5/min per email + 20/min per IP |
| Register | 5/h per IP + 3/h per email |
| Forgot password | 5/h per IP + 3/h per email |
| 2FA verify | 5 per challenge |
| Resend verification | 3/h per user |
| Password change | 5 per 15 min per user |
| Workspace creation | 10/h per user |
| Invitations | 50/h per workspace; 5 resends/h per invitation |
| Invitation accept | 20/h per IP |

**Not yet implemented** (Phase 12 hardening): the general 600/min authenticated limit, API-key limits, and the `RateLimit-*` response headers.

### Input, output and file safety

- All input is validated by Zod contracts, and unknown keys are stripped.
- Output: React escapes by default. `dangerouslySetInnerHTML` is forbidden (lint), and message text is rendered as plain text with a URL-linkify only.
- CSP on web: `default-src 'self'`. `connect-src` includes the API and WS origins, plus the MinIO public endpoint for presigned PUTs. `frame-src https://www.facebook.com` (Embedded Signup). No `unsafe-eval` in production.
- Uploads: allow-listed MIME types checked by magic-byte sniffing (`file-type`), not the extension. Size caps: images 5 MB, video 16 MB, audio 16 MB, documents 100 MB (the Meta limits), CSV imports 50 MB. Images are re-encoded (sharp) to strip EXIF and metadata before being used in templates.
- Search and filter: the filter DSL compiles to parameterized Prisma queries only. Raw SQL is limited to `packages/database/sql` and uses tagged templates.
- Outbound HTTP (automation webhook node, tenant webhooks): an SSRF guard blocks private, loopback, link-local and metadata IP ranges after DNS resolution. HTTPS is required except in dev. Timeout 10 s, response cap 1 MB.

### Audit

Audit these actions (non-exhaustive): auth events (login, logout, 2FA changes, password change, session revocation, refresh reuse), membership and role changes, invitations, WhatsApp connection changes, credential rotation, template submission, campaign launch/pause/stop, flow publish/pause, consent manual changes, exports, API key create/revoke, billing changes, and entitlement overrides.

### Phase 3 implementation notes (2026-09-24)

These describe what shipped where it refines the decisions above.

- **Default deny.** Global guards run in order: `AuthGuard` → `CsrfGuard` → `TenantGuard` → `PermissionGuard`. Every route needs a session unless it is marked `@Public()`. Tenant routes resolve membership through `TenantAccessService`, which the WebSocket gateway shares.
- **JWT.** EdDSA on `node:crypto` with no library. The header is fixed and never read back, so there is no `alg` confusion. MFA challenge tokens carry `purpose: 'mfa'` and are never accepted as access tokens. Outside production, keys are generated per boot when unset; production refuses to start without them (env schema).
- **CSRF.** The `fw_csrf` cookie is **HttpOnly**. Clients receive the value in login/refresh/`/auth/me` response bodies and echo it in `X-CSRF-Token`. This works across sibling subdomains without JS-readable cookies. `/auth/refresh` skips the header check: its cookie is `SameSite=Strict` and the Origin check still applies.
- **2FA.** TOTP codes are single-use per 30 s step (Redis `SET NX`). There are at most 5 attempts per login challenge. Backup codes are Argon2id-hashed and removed when used.
- **Breached passwords.** The bundled list is the NCSC top-100k, filtered to entries that could pass the 10-character minimum (9,126 entries, 42 KB gzipped).
- **Raw tokens never stored.** Email-verification, password-reset and invitation tokens are created by the worker. The database stores only a SHA-256 hash, and the outbox carries only IDs. A new token invalidates older unused ones.
- **Security events.** User-level events (sign-ins, failures, 2FA, session revocations, refresh-token reuse) go to the append-only `security_events` table, shown on Settings → Security. Tenant actions go to `audit_logs`.
- **Client IP.** `TRUST_PROXY` (default 0) sets how many reverse-proxy hops to trust for `X-Forwarded-For`. Leaving it >0 on a directly exposed API would let clients spoof their IP past per-IP rate limits.
- **Redis outages.** Application Redis commands queue for up to 2 s during reconnects, then fail. Connectivity errors map to **503 `UPSTREAM_UNAVAILABLE`**. Auth fails closed while Redis is unavailable, because the deny-set and rate limits can't be checked.
- **Verification.** `apps/worker/test/security-matrix.int.test.ts` discovers every tenant-scoped route from route metadata. It asserts 403 for every role × missing permission and 404 for every cross-tenant call, plus WebSocket room isolation. `packages/database/test/tenant-matrix.int.test.ts` does the same per tenant table, and fails when a new tenant table has no fixture.

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

### Outbound webhooks (automation, decision P10-D4)

- HTTPS only (`http:` refused in every environment except for the development hosts below). Methods: GET and POST.
- **SSRF guard** (`apps/api/src/core/http/safe-fetch.ts`): the hostname is rejected when it is `localhost`, `*.localhost`, `*.local`, `*.internal`, single-label, or a known metadata name. It is resolved once (all A/AAAA records), and **every** address must be public: loopback, RFC 1918, link-local (incl. 169.254.169.254), CGNAT, unique-local and link-local IPv6, IPv4-mapped IPv6, multicast, reserved and unspecified ranges are blocked. The TCP connection is pinned to the validated address (no second lookup, so no DNS rebinding).
- Redirects are followed manually, at most 3, each hop fully re-validated.
- Connect timeout 3 s, total timeout ≤ 10 s, response body capped at 64 KB.
- Request headers whose names look secret (`authorization`, `cookie`, `*token*`, `*secret*`, `*key*`, `*signature*`) are stored and logged as `[REDACTED]`. History shows the status, duration, a truncated response and the error.
- Credentials never follow a redirect to another origin (secret-looking headers are dropped). Credentials in the URL are refused.
- The inbound webhook trigger's token is 256-bit and stored only as its SHA-256 (X8); the HMAC secret is encrypted with the app key ring and shown once. The browser API's CORS allow-list includes `If-Match` (draft saves) and exposes `ETag`.
- Development exception: `AUTOMATION_WEBHOOK_DEV_HOSTS` (comma-separated host names) allows `http:` and private addresses **for those hosts only**. The env schema refuses it when `NODE_ENV=production`.
- **Reused unchanged for tenant outbound webhooks (Phase 11 Step 3, `docs/WEBHOOKS.md`):** every protection above applies identically to `webhook_endpoints` deliveries — the same `safeFetch`/`validateDestination`, not a second HTTP client. The webhook-endpoint-URL contract (`packages/contracts/src/api/webhooks.ts`) is deliberately a plain bounded string rather than a `https`-only schema, so this is the *only* place the policy is enforced — a contract-level duplicate would have made the dev-host exception unreachable.
- **Webhook signing:** every delivery carries `X-Fenwira-Signature: sha256=hmac_sha256(secret, "{timestamp}.{raw body}")`, `X-Fenwira-Timestamp`, `X-Fenwira-Event` and `X-Fenwira-Delivery`. Signing the timestamp is the replay protection (a captured delivery can't be replayed later with a forged newer timestamp without also forging the signature). Rotating a signing secret has no overlap window — the old secret stops verifying the moment rotation completes.

## Open questions

None. Resolved in the specification freeze (2026-09-26); see `PRODUCT.md` → Decision register.

## Platform operator (Phase 11 Step 5)

`PLATFORM_OPERATOR` is a separate global grant, never OWNER/ADMIN/membership/API scope. Grant/revoke only via restricted `platform:operator --user UUID --actor REFERENCE --reason TEXT [--revoke]` with migration credentials. Grant requires a verified enabled user with enrolled 2FA; runtime cannot change grants. Revocation/version change invalidates privilege. No customer conversation access is implied.

Platform login uses fresh password plus purpose-bound opaque challenge (5 minutes), atomically consumed with session creation, then fresh TOTP (Redis NX replay protection). Backup codes cannot establish platform privilege. Privilege uses separate Secure/HttpOnly/SameSite Strict cookies scoped to `/api/v1/platform`, 30-minute absolute / 10-minute idle limits, no refresh extension. Mutations require platform CSRF and origin checks; manage actions require MFA within 5 minutes. Reauthentication never extends absolute expiry. Every request checks grant version, identity, MFA enrollment and backing session family; password reset/change revokes that family. Active operators cannot disable 2FA; revoke grant first for recovery.

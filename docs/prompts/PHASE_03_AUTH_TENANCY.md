# Phase 3 — Authentication, Multi-Tenancy, RBAC & RLS

**Goal:** zero known cross-tenant access paths. This phase is the security foundation for everything after it.

**Read:** `AGENTS.md`, `docs/MULTI_TENANCY.md`, `docs/SECURITY.md`, `docs/DATABASE.md` (identity entities), `docs/API_SPEC.md`.

## Build

1. **Entities:** `User`, `Tenant`, `Membership` (user × tenant × role, with status), `Role`, `Permission`, `RolePermission` (seeded), `Invitation`, `Session`, `AuditLog`, `EmailVerificationToken`, `PasswordResetToken`.
2. **RLS:**
   - A SQL helper applies the standard policy (`ENABLE` + `FORCE` + `USING`/`WITH CHECK` on `tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid`) to every tenant-owned table. Put it in a Prisma migration.
   - `memberships` additionally allows `SELECT` where `user_id = app.current_user_id`, so a user can list their own tenants before choosing one.
   - `audit_logs`: revoke UPDATE and DELETE from `fenwira_app`.
3. **Tenant-scoped Prisma client:** `packages/database` exports `withTenant(tenantId, fn)`. It opens an interactive transaction, runs `SET LOCAL app.current_tenant_id`, and runs `fn`. Nest resolves tenant context from `AsyncLocalStorage`. A lint rule or code-review check forbids using the raw client in feature modules.
4. **Auth:**
   - Register → verify email (via Mailpit) → create workspace → user becomes OWNER → dashboard.
   - Login with an Argon2id password hash.
   - Sessions: a short-lived access JWT (15 minutes) plus a rotating refresh token (30 days) in HttpOnly, Secure, SameSite=Lax cookies. Refresh-token reuse revokes the session family. `Session` rows store the UA and IP. Users can list and revoke their sessions.
   - CSRF protection for cookie-authenticated mutations (double-submit token).
   - Forgot/reset password. Optional TOTP 2FA with the secret encrypted and backup codes hashed.
   - Rate-limit login, register and reset per IP and per email (Redis).
5. **RBAC:** roles `OWNER, ADMIN, MANAGER, AGENT, VIEWER` and a permission-key catalog (for example `team.manage`, `whatsapp.manage`, `contacts.write`, `inbox.reply`, `campaigns.launch`, `billing.manage`, `audit.view`). A `@RequirePermission()` decorator plus a guard. Only an OWNER can transfer ownership or delete the workspace. There is always exactly one OWNER.
6. **Tenant guard:** reads `X-Tenant-Id`, verifies an active membership, binds the context and loads permissions. It returns 404, not 403, for tenants the user doesn't belong to.
7. **Team and invitations:** invite by email (Mailpit), accept (new or existing user), change role, deactivate, resend or revoke an invite. Every change is written to AuditLog.
8. **WebSocket auth:** the gateway authenticates from the cookie on connect and verifies membership before joining `tenant:{id}` rooms. It re-checks when the client switches tenant.
9. **UI:** login, register, verify-email, forgot/reset, 2FA, workspace creation, the tenant switcher in the sidebar (changing tenant resets all client caches), Settings → Workspace, Team, Roles (read-only matrix), Security (sessions, 2FA), and Audit Logs.

## Mandatory security tests (integration, real Postgres as `fenwira_app`)

For every tenant-owned table and every endpoint group, Tenant A cannot:

- read Tenant B's data
- update it
- delete it
- search it
- export it
- access it through a WebSocket room

Also test:

- A query with no tenant context bound returns zero rows (it fails closed and does not error).
- A raw `INSERT` with a mismatched `tenant_id` is rejected by `WITH CHECK`.
- Each role gets 403 for every permission it lacks. Generate these tests from the role × permission matrix.
- A reused refresh token revokes the whole session family.

## Acceptance criteria

- [ ] Every flow in section 4 works end to end in the browser, with the emails visible in Mailpit.
- [ ] The cross-tenant test matrix passes. It is generated so that new tables must be added to it, and CI fails if a tenant-owned table has no RLS policy (checked through `pg_policies`).
- [ ] Switching tenant changes all data on screen, with no stale cache leaks.
- [ ] Auth endpoints are rate limited (a test proves it).
- [ ] `API_SPEC.md` and `DATABASE.md` are updated.

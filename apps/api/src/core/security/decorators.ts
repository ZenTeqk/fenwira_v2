import { type Permission, type Role } from '@fenwira/contracts'
import { SetMetadata } from '@nestjs/common'

export const PUBLIC_KEY = 'fenwira:public'
export const OPTIONAL_AUTH_KEY = 'fenwira:optional-auth'
export const TENANT_SCOPED_KEY = 'fenwira:tenant-scoped'
export const PERMISSION_KEY = 'fenwira:permission'
export const ROLE_KEY = 'fenwira:role'
export const SKIP_CSRF_KEY = 'fenwira:skip-csrf'
export const ALLOW_UNENROLLED_2FA_KEY = 'fenwira:allow-unenrolled-2fa'
export const PUBLIC_API_KEY = 'fenwira:public-api'

/** No authentication required (default is deny: every route needs a session). */
export const Public = () => SetMetadata(PUBLIC_KEY, true)
/** Public route that also reads the session when one is present. */
export const OptionalAuth = () => SetMetadata(OPTIONAL_AUTH_KEY, true)
/** Requires X-Tenant-Id and an ACTIVE membership (404 otherwise). */
export const TenantScoped = () => SetMetadata(TENANT_SCOPED_KEY, true)
/** Implies TenantScoped; 403 when the member's role lacks the permission. */
export const RequirePermission = (permission: Permission) => SetMetadata(PERMISSION_KEY, permission)
/** OWNER-only actions (ownership transfer, workspace deletion) — docs/SECURITY.md. */
export const RequireRole = (role: Role) => SetMetadata(ROLE_KEY, role)
/** Cookie-authenticated mutation that is safe without the double-submit token (SameSite=Strict). */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true)
/**
 * Marks a route reachable by a tenant API key (docs/API_KEYS.md → Public route allowlist).
 * Requires `@RequirePermission`: that permission is both the human RBAC check and the API-key
 * scope requirement, so the allowlist can never drift from what a key actually needs — the
 * OpenAPI `x-public` flag and `ApiKeyGuard`'s enforcement read the same two decorators. Every
 * other route answers 404 to an API key, never 403, so the private surface isn't discoverable.
 */
export const PublicApi = () => SetMetadata(PUBLIC_API_KEY, true)

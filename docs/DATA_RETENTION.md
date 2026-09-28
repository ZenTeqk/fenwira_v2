# Data retention

## Scope

What Fenwira keeps, for how long, and what happens to each kind of record when a tenant is finally deleted. The periods are configuration: changing one changes a value, not the deletion design (`MULTI_TENANCY.md` → Tenant deletion, decision T3).

## Retention categories

Every tenant table belongs to exactly one category. A CI check (added with the purge job) fails when a tenant table has no category.

| Category | Tables (examples) | While the tenant is live | At final tenant deletion | Period setting |
| --- | --- | --- | --- | --- |
| `CUSTOMER_DATA` | `contacts`, `contact_*`, `consents`, `tags`, `segments`, `conversations`, `conversation_*`, `messages`, `files` and their objects, `canned_replies` | Until deleted by the tenant | **Purged** | — |
| `CAMPAIGN_AUTOMATION` | `campaigns`, `campaign_recipients`, `flows`, `flow_versions`, `automation_*`, `templates`, `template_versions` | Until deleted by the tenant | **Purged** | — |
| `OPERATIONAL` | `webhook_events`, `outbox_events`, `idempotency_keys`, `webhook_deliveries`, `import_jobs`, `export_jobs`, `notifications` | Short-lived (below) | **Purged** | Per table (below) |
| `TENANT_SECRETS` | `whatsapp_credentials`, webhook signing secrets, API keys | Until revoked | **Revoked first, then purged** (Meta connections are disconnected, see T3) | — |
| `FINANCIAL` | `wallets`, `wallet_transactions`, `wallet_reservations`, `usage_events`, invoices | Kept | **Kept, pseudonymized**: amounts, dates, currency, category, country and IDs; no contact data or message content | `RETENTION_FINANCIAL_DAYS` |
| `AUDIT_SECURITY` | `audit_logs`, `security_events` | ≥ 1 year | **Kept, minimized**: actor and target IDs, action and time; free-text and `changes` bodies with personal data are removed | `RETENTION_AUDIT_DAYS` |
| `TENANT_RECORD` | `tenants`, `memberships`, `subscriptions` | Kept | **Pseudonymized tombstone**: the tenant ID, deletion dates and the purge record; the name and settings are removed | `RETENTION_FINANCIAL_DAYS` |
| `PLATFORM` | `users` (global accounts), `plans`, `price_book_entries` | Not tenant-owned | Untouched. A user's memberships in the deleted tenant are removed. | — |

The values of `RETENTION_FINANCIAL_DAYS` and `RETENTION_AUDIT_DAYS` for production are set by Legal/Finance before production launch. They are configuration, not code.

## Operational periods (live tenants)

| Data | Retention | Mechanism |
| --- | --- | --- |
| `webhook_events` | 30 days | `system.purge_expired` |
| `outbox_events` DISPATCHED | 7 days | `system.purge_expired` |
| `idempotency_keys` | 24 hours | `system.purge_expired` |
| `webhook_deliveries` | 30 days | `system.purge_expired` |
| `analytics_events`, `analytics_daily_rollups`, `analytics_conversation_episodes` | Per `analytics_retention` entitlement (P11-D15) | Nightly analytics retention (`ANALYTICS.md` → Retention); never touches operational, financial or audit records |
| Import/export files | 7 days | MinIO lifecycle + `files` cleanup |
| Logs | Configurable (decision O2) | Log platform |

## Open questions

None. Decisions T2 and T3: see `PRODUCT.md` → Decision register.

# Native connectors — contact workflows

8 October 2026. The user authorized starting native third-party connectors from the Integrations overview. The user selected ERPNext, Google Sheets, Zoho CRM and Shopify. ERPNext/Zoho CRM/Shopify import contacts; Google Sheets exports contacts. The user approved OAuth sign-in/install for Google Sheets, Zoho CRM and Shopify, and API key/secret authentication for ERPNext.

## Foundations reused

- `/integrations` has real WhatsApp connection, API-key and outbound webhook summaries. This implementation adds the four approved native providers through their own protected management and transfer services.
- `packages/config/src/crypto.ts` provides versioned AES-256-GCM encryption and key rotation support. Credentials must remain server-side and must not appear in connection DTOs, audit payloads or logs.
- `apps/api/src/core/database/tenant-db.ts` binds feature transactions to the authenticated workspace through `withTenant`. The three new connection/challenge/transfer tables have forced RLS and cross-tenant read/update/delete tests.
- `apps/api/src/core/http/safe-fetch.ts` validates public destinations, pins DNS resolution, bounds responses/timeouts and revalidates redirects. Provider adapters should use this boundary with a stricter redirect policy for credential-bearing requests.
- The existing audit service supports transaction-bound lifecycle events. The transactional outbox and worker infrastructure can persist sync intent before queue execution; native transfer requests reuse this infrastructure with durable receipts and lease-aware retry.
- Existing contacts and contact-import services provide possible import boundaries. A connector must use documented domain services and preserve consent; an imported external record does not grant WhatsApp marketing permission.

## Approved initial scope

Initial workflows are manual and user initiated. CRM/store imports prepare a contact CSV for the existing Contacts import review/mapping/duplicate-policy/confirmation workflow; no CRM/store data is written back and no consent is synthesized. Phone, name and email are the initial supported fields. The prepared import file contains Phone, Name and Email only; external identifiers never become tenant identifiers.

Google Sheets exports phone/name/email and Fenwira contact ID into a new dedicated tab in an explicitly chosen spreadsheet; the confirmation must explain that customer contact data leaves Fenwira. Export must use a deterministic range and preserve a durable snapshot/idempotency receipt so retries do not append duplicate rows. Do not overwrite unrelated sheet content.

Connection management requires integrations.manage. Preparing imports additionally requires contacts.import; exporting additionally requires contacts.export. Callback completion must recheck the authenticated member and bind a short-lived, single-use challenge to user, workspace, provider and destination. API keys cannot reach any native management route.

OAuth apps are server configuration. A missing app configuration is shown as setup unavailable, never Connected. Google offline refresh, Zoho regional endpoints and Shopify authenticated install/refresh must follow current official documentation. ERPNext credential validation uses a public HTTPS site via the existing SSRF-safe transport, without following credential-bearing redirects.

Disconnect removes local credentials and invalidates outstanding connection work; already imported contacts remain. Remote revocation/uninstall behavior must be stated explicitly, not inferred from deleting local credentials. Provider errors are sanitized codes with no raw payloads.

The implementation includes:

1. Shared request/response contracts and a documented tenant management API.
2. Tenant connection persistence with encrypted credentials, narrow authorization, CSRF protection and audit events.
3. A bounded connection verification call and explicit connection/error state based on real responses.
4. An idempotent, durable initial workflow with safe retries and visible run outcomes.
5. A real application card and setup/details workflow using the existing Experience V2 overview and shared UI.
6. Mock-provider tests for authentication failures, redaction, SSRF, retries, concurrent sync, tenant isolation and disconnect, plus browser permission/accessibility checks.

Only implemented providers receive working Connect actions. No fabricated connected states or unsupported capabilities are displayed. External writes require an explicitly defined workflow. Credentials should be entered through the protected application setup form, not supplied in chat.

## Boundaries

Native setup does not expand public API-key scopes or grant platform access. No generic RLS bypass is introduced. Subscription enforcement, provider-cost confidentiality, wallet accounting and existing WhatsApp sending/eligibility paths remain authoritative. No new connector entitlement, price or billing policy is implied by this scope.

The Integrations reconstruction remains a separate visual checkpoint. This work does not alter Phase 11 acceptance/closure; live provider acceptance remains separate.

## Authentication references

- [Frappe REST authentication](https://docs.frappe.io/framework/user/en/api/rest)
- [Google server-side OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Zoho authorization request](https://www.zoho.com/crm/developer/docs/api/v8/auth-request.html) and [regional support](https://www.zoho.com/crm/developer/docs/api/v8/multi-dc.html)
- [Shopify standalone authorization](https://shopify.dev/docs/apps/build/authentication-authorization/authenticate-standalone-apps)

These provider apps require operator registration/configuration before live account authorization can be verified. Mock tests must remain visibly separate from live-provider acceptance.

## Implemented configuration and workflow

Set the server-only NATIVE_GOOGLE_CLIENT_ID/SECRET, NATIVE_ZOHO_CLIENT_ID/SECRET and NATIVE_SHOPIFY_CLIENT_ID/SECRET pairs in the API and worker. Compose and .env.example expose these names without values. Register the exact `<WEB_ORIGIN>/integrations/native/callback` redirect URI in each provider console. Google needs Sheets API access and the spreadsheets OAuth scope; Zoho needs Contacts READ scope and the appropriate account region/multi-DC support; Shopify needs read_customers and permission to read protected phone/email customer data. Provider app registration/review and live credentials are not present in the local repository.

ERPNext setup verifies a dedicated API user's credentials against get_logged_user, then reads Contact records via public HTTPS. Do not enter credentials in chat. The protected setup dialog sends them to the server and clears the fields after connection.

Native transfers are queued from the transactional outbox to native.transfer. The worker claims a bounded lease, refreshes encrypted credentials as necessary, persists an encrypted snapshot, then prepares the existing Contacts import job or exports that snapshot. Import analysis also starts through the outbox and reuses the existing analyzer. Mapping, validation, duplicate handling and user confirmation remain in the Contacts workflow; imports default to suppressed automation and never derive consent from provider fields.

Sheets creates a distinct tab named `Fenwira Contacts <transfer UUID>` per export receipt. Retrying uses the same tab and immutable snapshot rather than appending duplicate rows; existing unrelated tabs are untouched. The exported columns are Fenwira contact ID, phone, name and email. Maximum 10,000 records per transfer is an initial technical bound; larger datasets fail explicitly. Provider pagination is followed within this bound.

Queued/retryable work is durable in Postgres. A failed transfer or a pending transfer whose lease has expired can be requeued from the connection history; this also restores execution after lost queue state. A currently leased transfer cannot be manually retried. Disconnect removes local credentials and prevents new work; already in-flight external requests may finish. Remote revoke/uninstall is a separate provider action.

## Live acceptance still required

Connect each provider with its registered app/real account, verify requested scopes and denied-consent behavior, test refresh/revocation, import a small contact set including duplicates/invalid phones without granting consent, and export to a nonproduction spreadsheet. Shopify customer-data approval and Zoho regional/multi-DC configuration must be verified for the intended distribution. These are live configuration/acceptance dependencies; mock success is not a claim of production connectivity.

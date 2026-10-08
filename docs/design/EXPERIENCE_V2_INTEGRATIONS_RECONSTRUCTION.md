# Integrations — Experience V2 reconstruction

8 October 2026. The user approved Analytics and authorized the next module. Reference: `experience-v2/09-Integrations.png`. Scope: Integrations overview and its existing management routes. Stop for Integrations visual review before Billing or Settings.

## Reference and repository mapping

The reference presents the approved light shell, a broad WhatsApp summary, paired API/Webhooks cards and a compact endpoint table. The repository previously redirected `/integrations` to `/integrations/whatsapp`; it already has WhatsApp connection, API-key and webhook management screens and tenant-scoped read/mutation adapters.

`/integrations` now presents a real overview using ListPage, Card, StatusBadge, Button, DataTable and existing tenant query keys. The navigation catalog adds an Overview entry, preserving permission filtering and the existing management routes. Integrations opts into the canonical 224px sidebar/56px header. Its overview omits duplicate shell tabs; management routes retain their existing module tabs and forms.

## Supported data and operations

- Each authorized WhatsApp connection shows actual identity, phone number, connection status, quality, Meta webhook subscription and last sync. Multiple numbers remain distinct. Sync calls the existing connection sync endpoint and invalidates the same tenant-scoped query used by the management screen. Management links retain setup, token rotation, test, rename, default-number and consequential disconnect workflows.
- API shows configured active-key counts, excluding revoked/expired records for display only. API access and authorization remain server-owned. No key secrets or credential fragments appear in the overview.
- Webhooks shows configured/active endpoint counts, persisted status, selected event count and consecutive failure count. Active means configured active, not verified delivery health. Detailed deliveries, retries, secret rotation and endpoint changes remain in the existing management screen.
- Endpoint destinations show origin/path; query parameters are omitted to avoid displaying query credentials. Destination links navigate to the internal manager, not the external URL.
- Existing entitlement metadata drives suspension notices. Keys and endpoints remain visible and retained when entitlement is lost; the overview does not grant capabilities or alter enforcement.

WhatsApp reads require whatsapp.read, Sync requires whatsapp.manage, and API-key/webhook reads require integrations.manage. A member with neither overview read capability sees a permission state; unauthorized queries are disabled. Tenant-scoped cache keys, session/CSRF headers, API-key allowlists, RLS and `/platform` separation are unchanged.

## Intentional reference differences

No native ERPNext, Zoho, Shopify, Google Sheets, Slack, Teams or Activepieces connector exists in this repository. No decorative connected-app grid or inactive Connect buttons are added. Customers can use the actual API and webhooks for their own integrations.

The API has no seven-day request-count aggregate. The endpoint list has no last-delivery timestamp or health DTO. Neither is fabricated or inferred from updatedAt/status. Counts, names, URLs and statuses come from authorized API responses, not the reference examples. Existing semantic icon tokens are used; no third-party logos or new palette is introduced.

## Validation and checkpoint

[Review evidence](experience-v2/evidence/integrations-reconstruction/README.md) records actual local API captures separately from clearly labelled browser response fixtures. Tests cover widths 1440/1024/768/375, keyboard Sync, permissions, disabled reads, URL redaction, entitlement suspension, retries and existing API-key/webhook/WhatsApp workflows.

No backend, contracts, schema, worker, financial data, subscription flags or commercial policy is changed. This is an Experience V2 visual checkpoint, not Phase 11 closure or an external deployment.

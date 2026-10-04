# Outbound Webhooks

## Scope

Lets a tenant's own application react the moment something happens in Fenwira — a message status changes, a contact is created, a campaign finishes — without polling the API. Decision P11-D18 (a curated public event allowlist, never arbitrary internal activity) and P11-D23 (provider cost and internal margin never appear in a webhook payload).

## Endpoint creation

`POST /webhook-endpoints` (`integrations.manage`, never reachable by an API key — see `docs/API_KEYS.md`):

```json
{ "name": "Production CRM", "url": "https://example.com/webhooks/fenwira", "events": ["contact.created"] }
```

Returns `{ endpoint, secret }` — the signing secret, shown once (see *Signing* and *Secret rotation*). `url` is validated twice, deliberately in different places for different reasons:

1. **Shape**, in the Zod contract (`createWebhookEndpointRequestSchema`): a bounded string, nothing more. It is deliberately *not* `z.url({ protocol: /^https$/ })` — a hard `https` requirement at this layer would make the development-host exception below unreachable, since the contract runs before the service does.
2. **Security policy**, in `WebhooksService.assertUrl`, which calls the same `validateDestination` that Phase 10's automation webhook action already uses (`apps/api/src/core/http/safe-fetch.ts`) — see *SSRF restrictions*. This is the one and only place https-only and address-blocking policy is enforced; nothing in the contract layer duplicates or could drift from it.

## Event allowlist (decision P11-D18)

Exactly these 8 domain events are ever delivered — never an arbitrary internal event, and never surfaced through this mechanism without a product decision to add it:

| Event | Family | Fires when |
| --- | --- | --- |
| `message.status.changed` | Messages | An outbound message's delivery status changes (sent/delivered/read/failed) |
| `message.inbound.received` | Messages | A customer message arrives |
| `conversation.opened` | Conversations | A conversation opens or reopens |
| `conversation.assigned` | Conversations | A conversation is assigned to an agent |
| `contact.created` | Contacts | A contact is created |
| `contact.updated` | Contacts | A contact's fields change |
| `campaign.completed` | Campaigns | A campaign finishes dispatching |
| `automation.execution.finished` | Automations | An automation run finishes |

An endpoint subscribes to any subset; fan-out only reaches endpoints whose `events` includes the fired type (`WebhookEventsProcessor.fanOut`, `apps/api/src/modules/webhooks/webhook-events.processor.ts`).

## Payload envelope and versioning

```json
{
  "id": "<delivery id, changes on every attempt>",
  "type": "contact.created",
  "apiVersion": "2026-09-28",
  "createdAt": "2026-10-04T12:00:00.000Z",
  "eventId": "<source event id, stable across every attempt and redelivery>",
  "data": { "contactId": "...", "source": "MANUAL" }
}
```

This is a **stable, independently-versioned external contract** (`webhookPayloadSchema`, `packages/contracts/src/api/webhooks.ts`) — deliberately decoupled from whatever internal shape the domain event itself carries, which may change freely. `apiVersion` is a date; a breaking change to the payload ships as a new date, and existing subscribers keep the shape they signed up for until they opt in to the new one. `data` carries only IDs (never money, never provider cost, never PII beyond what the event itself is about) — the receiver calls the regular API with those IDs for anything else it needs.

**`id` vs `eventId`:** `id` is this *delivery attempt's* id and changes if the delivery is retried or manually redelivered; `eventId` is the *source event's* id and never changes. Deduplicate on `eventId` (see *Duplicate delivery*), not `id`.

## Signing

Every delivery carries:

| Header | Contents |
| --- | --- |
| `X-Fenwira-Signature` | `sha256=<hex HMAC-SHA256 of "{timestamp}.{raw body}", keyed by the endpoint's signing secret>` |
| `X-Fenwira-Timestamp` | Unix epoch milliseconds, as a string — the same value signed above |
| `X-Fenwira-Event` | The event type (matches `payload.type`) |
| `X-Fenwira-Delivery` | This delivery's id (matches `payload.id`) |

`signWebhookBody`/`verifyWebhookSignature` (`apps/api/src/modules/webhooks/webhook-signing.ts`). Because the timestamp is part of the signed string, an attacker who captured one delivery cannot replay it later with a forged, newer timestamp without also forging the signature — this is the replay protection, not a separate nonce scheme.

## Signature verification (receiver-side)

1. Read `X-Fenwira-Timestamp` and reject if it's further than a few minutes from your own clock (replay protection).
2. Recompute `sha256=` + `hmac_sha256(signing_secret, "{timestamp}.{raw request body}")` — **use the raw bytes**, not a re-serialized JSON object (whitespace/key-order differences break the signature).
3. Compare to `X-Fenwira-Signature` with a constant-time comparison.

See *Signature verification example* below.

## Retries and backoff

A failed attempt (`WebhookEventsProcessor.send`) is retried with exponential backoff — `min(WEBHOOK_BACKOFF_MS × 2^(attempt-1), 1 hour)` — for up to `WEBHOOK_MAX_RETRY_HOURS` (default 24h, minimum 0.1h) measured from the *delivery's* creation, not the endpoint's. Retry scheduling is self-managed (a BullMQ delayed job per attempt, `attempts: 1`, since the retry loop itself decides whether to reschedule) rather than relying on BullMQ's own retry — so the endpoint's `failureCount` and the delivery's persisted state always agree with what actually happened. Once the retry window elapses without success, the delivery becomes terminally `FAILED` and the endpoint's `failureCount` increments.

## Duplicate delivery

**Duplicate delivery is normal webhook behavior, not a bug** — a redelivered domain event, a manual retry, or (rarely) two near-simultaneous attempts can all result in more than one HTTP call for the same logical event. Fan-out is idempotent at the database level: `webhook_deliveries` has a unique constraint on `(endpoint_id, event_id)`, and `createDelivery` is an atomic `upsert` against it — a redelivered event finds (and reuses) the existing row rather than creating a second one or raising an error.

**Consumers must deduplicate on identity, not on "I haven't seen this HTTP call before."** Use `eventId` (stable across every attempt) or, for finer granularity, the `(eventId, attempt)` pair if you want to tell attempts apart; never assume "one call in, one effect out" without checking.

## Manual retry

`POST /webhook-endpoints/{id}/deliveries/{deliveryId}/retry` — only from a `FAILED` delivery; resets it to `PENDING` and enqueues a fresh send attempt immediately (not subject to the original backoff schedule). Available from the Deliveries tab of the webhook detail page.

## Endpoint auto-disable behavior

An endpoint is automatically set `DISABLED` after `WEBHOOK_DISABLE_AFTER_FAILURES` (default 20) consecutive terminal `FAILED` deliveries. When this happens:

- Every OWNER/ADMIN in the workspace gets a notification (bell + the standard notification channel), linking to `/integrations/webhooks/{id}`.
- No further deliveries are attempted until the endpoint is manually set back to `ACTIVE` (`PATCH /webhook-endpoints/{id}` with `status: 'ACTIVE'`, or the **Re-enable** action in Settings).
- The UI shows a persistent danger banner on the endpoint's detail page explaining why it was disabled, when the last successful delivery was, and how to recover: fix the receiver, send a test delivery to confirm it's reachable, then re-enable.

## Secret rotation

`POST /webhook-endpoints/{id}/rotate-secret` generates a new secret and returns it once, exactly like creation. **There is no overlap/grace window** — the old secret stops verifying the moment rotation completes. If your receiver needs zero-downtime rotation, update it to accept the new secret *before* rotating, or accept a short gap where in-flight retries signed with the old secret fail (they'll retry and eventually succeed once you've updated, within the normal retry window). The UI's rotation confirmation states this plainly; it does not imply a grace period that doesn't exist.

## SSRF restrictions

Enforced once, centrally, in `safeFetch`/`validateDestination` (`apps/api/src/core/http/safe-fetch.ts`) — reused unchanged from Phase 10's automation webhook action, not a second HTTP client:

- **HTTPS only** in production. Credentials embedded in the URL (`user:pass@host`) are rejected.
- **Private, loopback, link-local, and other reserved address ranges are blocked** — checked both at creation time (`WebhooksService.assertUrl`, no network hop) and again at delivery time via DNS resolution immediately before connecting (so a DNS record that resolves differently later, or a redirect to an internal address, is still caught).
- **Redirects are re-validated** at each hop against the same policy.

## Development-host exception

`AUTOMATION_WEBHOOK_DEV_HOSTS` (comma-separated hostnames, e.g. `127.0.0.1`) lets exactly those hostnames use `http://` and bypass the private-address check — for local development and the integration test suite's local receiver only. It is refused outright in production (`loadEnv`'s `superRefine`). This is the one and only sanctioned bypass of the policy above; it is not a general allowlist mechanism.

## Test deliveries

`POST /webhook-endpoints/{id}/test` creates a synthetic delivery (`eventType: 'webhook.test'`) and sends it immediately, so an integrator can verify their receiver end to end — signed and delivered exactly like a real event, through the same `WebhookEventsProcessor.send` path, and recorded as an ordinary row in `webhook_deliveries` (visible in the Deliveries tab with a **Test** badge, not a separate fake mechanism). `payload.type` is `"webhook.test"` and is intentionally outside the strict `webhookPayloadSchema` enum used for real events — handle an unrecognized `type` gracefully rather than rejecting it.

## Observability and troubleshooting

See `docs/OBSERVABILITY.md` for the full metrics list. For a specific failing endpoint: open its detail page → **Deliveries**, filter by status, and open a delivery for its full request payload, response status/body (capped at 4000 characters) and duration. A `FAILED` delivery with `nextAttemptAt` set is still retrying; one without is terminal. `errorCode` on a network-level failure (no HTTP response at all) comes from `SafeFetchError`'s code (e.g. `WEBHOOK_BLOCKED_DESTINATION`) rather than an HTTP status.

## Errors

| Code | Status | When |
| --- | --- | --- |
| `WEBHOOK_URL_INVALID` | 422 | Malformed URL, or `http://` outside the dev-host exception |
| `WEBHOOK_BLOCKED_DESTINATION` | 422 | Resolves to a private/reserved/internal address |
| `ENTITLEMENT_REQUIRED` | 403 | The workspace's plan doesn't include `webhooks_enabled` |
| `CONFLICT` | 409 | Manual retry on a delivery that isn't `FAILED` |
| `NOT_FOUND` | 404 | Unknown endpoint or delivery id |

## Examples

### Payload envelope

See *Payload envelope and versioning* above.

### Signature verification (Node.js)

```js
const crypto = require('node:crypto')

function verify(secret, timestamp, rawBody, signatureHeader) {
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`
  const a = Buffer.from(expected)
  const b = Buffer.from(signatureHeader)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
```

### Duplicate-event handling

```js
const seen = new Set() // persist this in your own store, not in memory, in production
app.post('/webhooks/fenwira', (req, res) => {
  const { eventId } = req.body
  if (seen.has(eventId)) return res.sendStatus(200) // already processed — ack, don't reprocess
  seen.add(eventId)
  // ... handle the event ...
  res.sendStatus(200)
})
```

## Retention

Delivery history is purged after 30 days (`system.tenants_with_stale_webhook_deliveries` / `system.purge_webhook_deliveries`, a nightly worker job) — age-only, per tenant, never touching endpoints or secrets. `docs/DATA_RETENTION.md` for the platform-wide retention table.

## UI

`/integrations/webhooks` (`apps/web/app/(app)/integrations/webhooks/page.tsx`): endpoints as integration cards (status dot, URL, subscribed event-family count, health, Manage) rather than a dense table. Creation is a 4-step guided flow — Endpoint URL → Events (grouped by family, from the allowlist above only) → Security (what protections apply, no configuration needed) → Review — ending in the one-time secret dialog. The detail page (`/integrations/webhooks/[id]`) has Overview / Deliveries / Settings tabs; a delivery row opens a `DetailDrawer` (never a page navigation) with the full safe request/response metadata described above. A disabled endpoint shows the persistent danger banner described in *Endpoint auto-disable behavior*. Visibility of the whole page follows `integrations.manage` from the backend.

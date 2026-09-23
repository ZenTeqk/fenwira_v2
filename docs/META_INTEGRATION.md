# Meta Integration

## Scope

How Fenwira integrates with the Meta WhatsApp Cloud API: the platform app setup, Embedded Signup, token handling, the Graph endpoints used, webhook subscriptions, error classification, throughput, and the 24-hour service window.

## Decisions

### Platform model

- Fenwira operates **one Meta app** as a Tech Provider. Every tenant connects **their own** WABA and phone number to that app through Embedded Signup. Fenwira never owns a customer's WABA.
- Platform-level config comes from env and is never stored per tenant:

| Env | Use |
| --- | --- |
| `META_APP_ID` | FB JS SDK init, token exchange |
| `META_APP_SECRET` | Token exchange, **webhook signature verification** |
| `META_WEBHOOK_VERIFY_TOKEN` | `GET /webhooks/whatsapp` handshake |
| `META_ES_CONFIG_ID` | Embedded Signup configuration ID |
| `META_GRAPH_API_VERSION` | Pinned Graph version (for example `v23.0`). Upgrades are deliberate and go through a PR. |
| `META_GRAPH_BASE_URL` | Default `https://graph.facebook.com`. Overridden with a mock server in tests. |
| `WHATSAPP_DEV_CONNECT` | Enables the manual dev connect path (never in production) |

- The app webhook callback URL is `{PUBLIC_API_URL}/webhooks/whatsapp`, configured once in the Meta app dashboard. Local development needs a tunnel (for example `cloudflared`); see `DEPLOYMENT.md`.

### Required permissions

`whatsapp_business_management`, `whatsapp_business_messaging` and `business_management` (to read the business portfolio).

### Embedded Signup flow

```text
Browser                                   Fenwira API                               Meta
───────                                   ───────────                               ────
GET /config/whatsapp-signup  ───────────►  {appId, configId, graphVersion}
FB.login({config_id, response_type:'code',
  override_default_response_type:true,
  extras:{sessionInfoVersion:3, setup:{}}})  ─────────────────────────────────────►  user completes signup
window 'message' (WA_EMBEDDED_SIGNUP FINISH)  ◄───────── {waba_id, phone_number_id}
FB.login callback  ◄──────────────────────────────────────────────────────────────── {code}
POST /whatsapp/connections {code, wabaId, phoneNumberId}  ──►
                                          step 1 EXCHANGE: GET /oauth/access_token?client_id&client_secret&code ──► business token
                                          step 2 VERIFY:   GET /debug_token → scopes include whatsapp_*; granular_scopes contain wabaId
                                          step 3 FETCH:    GET /{waba_id}?fields=id,name,currency,timezone_id,message_template_namespace,owner_business_info
                                                           GET /{waba_id}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,messaging_limit_tier,throughput,status
                                          step 4 UNIQUE:   system.phone_number_owner_exists(phoneNumberId) → 409 if another tenant
                                          step 5 STORE:    insert MBA/WABA/phone/credential (encrypted)
                                          step 6 SUBSCRIBE: POST /{waba_id}/subscribed_apps
                                          step 7 REGISTER: POST /{phone_number_id}/register {messaging_product:'whatsapp', pin}
                                                           (pin = random 6 digits, stored encrypted; skip if already registered)
                                          step 8 VALIDATE: GET /{phone_number_id} → status CONNECTED
◄──────────────── {connection, steps:[{key, status, error?}]}
```

- Each step records its status on the connection (stored in `whatsapp_phone_numbers.status_detail` as JSON). Retrying resumes from the first non-completed step. Steps 6–8 are idempotent at Meta.
- The code-exchange token is a **business integration system user token** (long-lived). `debug_token` gives `expires_at` (usually 0 = never). The daily `whatsapp.sync` job re-checks it and marks the credential `INVALID` on error 190.
- Disconnect: `DELETE /{waba_id}/subscribed_apps` (only if no other number of this tenant uses the WABA), then wipe the credential ciphertext, set the number to DISCONNECTED, and audit it.

### Dev connect (flagged)

`POST /whatsapp/connections/dev {wabaId, phoneNumberId, accessToken}`. It is for the Meta test number and a system-user token from the developer dashboard. It runs steps 2–8, skipping registration for test numbers.

### Graph endpoints used (via `packages/whatsapp`)

| Purpose | Endpoint | Module |
| --- | --- | --- |
| Send any message | `POST /{phone_number_id}/messages` | messaging (outbound worker only) |
| Mark read (+ typing indicator) | `POST /{phone_number_id}/messages` `{status:'read', message_id}` | messaging (queued) |
| Download media | `GET /{media_id}` → `url`, then `GET url` with the bearer token | messaging (media worker) |
| Upload media for a send | `POST /{phone_number_id}/media` | messaging |
| Template CRUD | `GET/POST /{waba_id}/message_templates`, `POST /{template_id}`, `DELETE /{waba_id}/message_templates?name=` | templates |
| Template header sample upload | Resumable upload `POST /{app_id}/uploads` → `POST /{upload_id}` → handle | templates |
| Phone and WABA sync | `GET /{phone_number_id}`, `GET /{waba_id}` | whatsapp-accounts |

The client exposes typed functions. Each call takes the decrypted credential as an argument; the package never reads the DB.

### Webhook fields subscribed

`messages` (inbound, statuses including pricing), `message_template_status_update`, `message_template_quality_update`, `template_category_update`, `phone_number_quality_update`, `account_update`.

### Error classification (`packages/whatsapp/errors.ts`)

| Code(s) | Meaning | Class | Handling |
| --- | --- | --- | --- |
| Network error, timeout, HTTP 5xx, `1`, `2`, `131000` | Transient/unknown | RETRYABLE | Backoff |
| `4`, `80007`, `130429` | App/WABA/throughput rate limit | RETRYABLE_RATE | Long backoff (60 s base) + reduce the limiter |
| `131056` | Pair rate limit (same recipient too fast) | RETRYABLE_RATE | Delay ≥ 6 s for the same recipient |
| `131048` | Spam rate limit | RETRYABLE_RATE | Long backoff. Alert the tenant (quality risk). |
| `190` | Access token expired/invalid | CREDENTIAL | FAILED. Credential INVALID. Notify admins. |
| `10`, `200`, `299` | Permission error | CREDENTIAL | As 190 |
| `131047` | Re-engagement required (outside 24h) | PERMANENT | FAILED (`CONVERSATION_WINDOW_CLOSED`) |
| `131026` | Message undeliverable | PERMANENT | FAILED |
| `131049` | Not delivered to maintain a healthy ecosystem (marketing per-user limit) | PERMANENT | FAILED. Campaign recipient FAILED (not retried). |
| `131050` | User stopped marketing messages | PERMANENT | FAILED **and** revoke MARKETING consent (source `META_OPT_OUT`) |
| `131051`, `131052`, `131053` | Unsupported type / media download / upload error | PERMANENT | FAILED |
| `132000`, `132001`, `132005`, `132007`, `132012`, `132015`, `132016` | Template param mismatch / not found / paused / disabled | PERMANENT | FAILED. Trigger a template sync. |
| `131031` | Account locked | PERMANENT | FAILED. Phone RESTRICTED. Notify. |
| `368` | Temporarily blocked for policy | PERMANENT | FAILED. Phone FLAGGED. Notify. |
| `100` | Invalid parameter | PERMANENT | FAILED. Log the field only. |
| Anything else | Unknown | RETRYABLE (max 2 attempts), then PERMANENT | Log the code for triage |

Mapped errors expose `{class, code, title, fenwiraCode}`. The mapping table has unit tests.

### Throughput and limits

- **Throughput:** Meta allows a per-number rate, 80 messages/second by default (more for higher tiers, as reported by the API). Stored in `whatsapp_phone_numbers.throughput_mps`, and enforced by the Redis token bucket in the outbound worker.
- **Messaging limits:** Meta limits business-initiated conversations to unique users per rolling 24 h by tier. Store Meta's reported tier as-is (`messaging_limit_tier`). The campaign engine estimates against it and warns in the Review step. Meta enforces the limit; we don't hard-block on it.
- **Quality:** GREEN, YELLOW or RED, from `phone_number_quality_update`. RED shows a banner and a notification, and campaign launches show a warning.

### 24-hour customer service window

- The window opens or refreshes on **every inbound customer message**: `service_window_expires_at = inbound provider_timestamp + 24h`.
- Inside the window, any message type can be sent. Outside it, only approved templates.
- Fenwira enforces this server-side in `MessagingService` (and re-checks in the worker), so we never rely on Meta's 131047.
- The UI shows the countdown from `service_window_expires_at` (it never computes the window itself).

### Pricing signal

Status webhooks contain `pricing {billable, pricing_model, category}`. The billing module prices each billable message by category and recipient country (`BILLING.md`). Idempotent on `message_id`.

### Testing

A `meta-mock` HTTP server (in `packages/whatsapp/testing`) implements the endpoints above with scripted responses and errors. It is used by integration tests and a docker-compose `test` profile. Signature helpers generate valid and invalid `X-Hub-Signature-256` for webhook tests. A small smoke suite runs against the real Meta test number manually, before each release.

## Open questions

| # | Question | Owner |
| --- | --- | --- |
| MI1 | Has Fenwira's Meta app completed Tech Provider onboarding and business verification? This gates real Embedded Signup. | Business |
| MI2 | Should we support the 72-hour free entry point (click-to-WhatsApp ads) window in v2? Assumed no. | Product |
| MI3 | Should we support coexistence (numbers that also use the WhatsApp Business app)? Assumed no. | Product |

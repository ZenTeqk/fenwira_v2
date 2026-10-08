# Integrations visual checkpoint — 8 October 2026

Ready for visual review against `09-Integrations.png`. The user approved Analytics and supplied this reference again during implementation. [Repository mapping and supported capabilities](../../../EXPERIENCE_V2_INTEGRATIONS_RECONSTRUCTION.md).

## Review locally

Open `http://localhost:3000/integrations` in the existing [Fenwira Textiles local demo workspace](../textile-campaign-demo/README.md). The sidebar now opens this overview. WhatsApp management, API-key management and webhook management remain on their existing routes.

Captures below use actual local tenant APIs. This workspace has a connected simulated WhatsApp number and no API keys or outbound webhook endpoints, so those counts and the endpoint empty state reflect the actual records. No records were fabricated or seeded for the overview capture. The screenshot's native third-party connector grid is intentionally omitted: this repository supports WhatsApp, tenant API keys and outbound webhooks.

## Responsive captures

| View | 1440px | 1024px | 768px | 375px |
| --- | --- | --- | --- | --- |
| Overview | [Image](overview-1440.png) | [Image](overview-1024.png) | [Image](overview-768.png) | [Image](overview-375.png) |
| WhatsApp | [Image](whatsapp-1440.png) | [Image](whatsapp-1024.png) | [Image](whatsapp-768.png) | [Image](whatsapp-375.png) |
| API | [Image](api-1440.png) | [Image](api-1024.png) | [Image](api-768.png) | [Image](api-375.png) |
| Webhooks | [Image](webhooks-1440.png) | [Image](webhooks-1024.png) | [Image](webhooks-768.png) | [Image](webhooks-375.png) |

[Viewport results](validation.json): zero WCAG A/AA axe violations and no document horizontal overflow in all 16 combinations. The wide endpoint table scrolls locally on narrow screens.

## Populated test states

Browser-only response fixtures exercise connected numbers, active/revoked keys, active/disabled endpoints, sync outcomes, query-parameter redaction and entitlement suspension. They do not persist these example records. [Populated desktop fixture](fixture/overview-1440.png), [mobile fixture](fixture/overview-375.png). These images are separately labelled because their data differs from the real demo workspace.

## Validation

- Web lint/typecheck: passed.
- Web tests: **18 passed across 5 files**, including the intentional Overview navigation change.
- Design token checks, dependency boundaries (785 modules) and diff whitespace checks: passed.
- Browser suite: **5 passed in 35.0s**. Covers overview at four widths, keyboard Sync, success/failure feedback, query redaction, retained records during suspension, empty/denied states, disabled unauthorized queries and retry; actual API-key creation/one-time secret/revocation; actual webhook creation/one-time secret/test delivery; simulated WhatsApp connect/test message/disconnect through the existing management screen.
- [Authenticated Lighthouse accessibility](lighthouse.json): **100**, no failed audits (13.5.0).
- Production frontend build/restart: passed, healthy.
- Final local smoke: passed API readiness, frontend/sign-in rendering and outbox → relay → queue → worker.

The session-response permission fixture tests UI gating and disabled queries; it does not claim a new server authorization grant. The full backend Phase 11 integration suite was not rerun for this presentation-only checkpoint. No backend/contracts/schema/worker/billing configuration changed.

Temporary Playwright output, raw Lighthouse report and browser profile were removed after curating these captures. Stop for Integrations visual review before Billing/Settings. No external deployment or Phase 11 closure.

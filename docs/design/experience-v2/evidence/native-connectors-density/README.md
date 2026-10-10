# Native connectors and module density — 8 October 2026

The user approved ERPNext/Zoho CRM/Shopify contact imports and Google Sheets contact exports, with OAuth for Google/Zoho/Shopify and ERPNext API key/secret authentication. [Configuration, scope and live acceptance](../../../../NATIVE_CONNECTORS.md).

The five requested modules now use compact page headings, descriptions, summary icons, campaign artwork and spacing. Analytics charts measure their container width instead of enlarging their entire SVG; the overview graph is 160px tall. The desktop automation canvas is 480px/544px. Template context occupies 288px. Long content can scroll without shrinking body text or touch targets.

## Evidence boundaries

The `fixture/` screenshots come from browser response fixtures or test-only workspaces and demonstrate populated Analytics/Automation states and native setup availability. They do not claim live third-party connectivity. The local textile demo screenshots and machine-readable viewport/Lighthouse results are captured separately. OAuth app registration and real-account authorization/refresh/revocation remain outstanding external acceptance steps.

No subscription rollout flags, prices, financial history or messaging/consent authorization were changed. This checkpoint does not declare Phase 11 closed.

## Verified implementation checks

- Repository lint, dependency boundaries, design lint and typecheck passed.
- All nine packages' unit tests passed sequentially: 320 tests, including 9 native provider adapter tests and a real HTTP PUT-body regression.
- The forced-RLS database regression passed: 263 tests, including the 244-case tenant matrix covering all three new tables.
- The native database/worker regression passed: 11 tests covering private authorization, concurrent and expiring OAuth challenges, three provider import paths, consent-safe import confirmation, Sheets disclosure/idempotency, concurrent requests, immutable snapshot retry, disconnect and queued permission revocation.

The broad worker run passed 223 cases and timed out in three existing cases under local contention. All three subsequently passed in isolation with their original assertions/time limits: configured downgrade (5.1s), 2,000-contact campaign (216.2s test; 213.5s campaign completion), and Inbox collision control (2.4s). No Step 4 domain code or test limits were changed. Across the broad run and isolated rerun, all 226 non-performance worker cases passed; the two opt-in performance suites were skipped. This is not a claim that the initial broad run passed in one attempt. API integration checks also passed (10 cases).

- The combined browser regression passed: 13 tests across native connectors, Templates, Campaigns, Automations, Analytics and Integrations; one opt-in browser Lighthouse case was skipped in favor of the separate five-page audit.
- The actual local textile workspace passed all 20 viewport checks (five pages at 1440, 1024, 768 and 375px): no horizontal page overflow or axe violations, with 20px page headings. See `validation.json`.
- Separate Lighthouse accessibility audits scored 100 on each of those five pages. See `lighthouse.json`.
- User changes were preserved: official integration logos, display-only phone formatting, campaign preview labels, chart label spacing, automation layout fallback and the existing UI audit artifacts.

- Local worker restored and healthy. `pnpm smoke` passed API readiness, frontend sign-in rendering and the API → outbox → relay → queue → worker round trip.

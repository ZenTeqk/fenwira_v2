# Analytics visual checkpoint — 8 October 2026

The user approved Automations and authorized Analytics next. Reference: `08-Analytics.png`. [Repository mapping, changes and product differences](../../../EXPERIENCE_V2_ANALYTICS_RECONSTRUCTION.md).

## Review the real local workspace

Open `http://localhost:3000/analytics` in the existing [Fenwira Textiles local demo workspace](../textile-campaign-demo/README.md). Data comes from its actual tenant-scoped Analytics endpoints. No synthetic metric records were added for this checkpoint. The workspace has campaign activity and an unpublished automation draft; no automation runs in the period is a valid empty state.

The compact white metric strip, daily messaging chart, engagement indicators and campaign/team/automation panels follow the reference's composition. Actual supported measures and their definitions remain authoritative. Earlier approved module compositions are preserved. This is ready for visual review, not an exact-match claim for the reference's example numbers or unsupported metrics.

## Responsive evidence

| View | 1440px | 1024px | 768px | 375px |
| --- | --- | --- | --- | --- |
| Overview | [Image](overview-1440.png) | [Image](overview-1024.png) | [Image](overview-768.png) | [Image](overview-375.png) |
| Messaging | [Image](messaging-1440.png) | [Image](messaging-1024.png) | [Image](messaging-768.png) | [Image](messaging-375.png) |
| Campaigns | [Image](campaigns-1440.png) | [Image](campaigns-1024.png) | [Image](campaigns-768.png) | [Image](campaigns-375.png) |
| Inbox | [Image](inbox-1440.png) | [Image](inbox-1024.png) | [Image](inbox-768.png) | [Image](inbox-375.png) |
| Automations | [Image](automations-1440.png) | [Image](automations-1024.png) | [Image](automations-768.png) | [Image](automations-375.png) |
| Usage | [Image](usage-1440.png) | [Image](usage-1024.png) | [Image](usage-768.png) | [Image](usage-375.png) |

[Machine-readable viewport checks](validation.json): zero WCAG A/AA axe violations and no document horizontal overflow in all 24 view/width combinations. The separately verified custom-date wrapping regression also passes at [1440px](custom-dates-1440.png) and [375px](custom-dates-375.png); [results](custom-dates-validation.json). Chart table alternatives retain the same values; wide report tables scroll locally, and Analytics navigation scrolls horizontally on narrow screens.

## Test-only populated states

The reconstruction browser spec uses clearly labelled response fixtures for populated overview/team/engagement states. It does not persist those metrics. Its separate curated [desktop fixture](fixture/overview-1440.png) and [mobile fixture](fixture/overview-375.png) demonstrate populated compositions; they are not the real demo workspace's figures.

## Validation

- Web and shared UI lint/typecheck: passed.
- Shared UI tests: **55 passed across 6 files**; web tests: **18 passed across 5 files**.
- Semantic design checks, dependency boundaries (782 modules) and diff whitespace checks: passed.
- Browser coverage: **6 scenarios passed after correction**. The broader run passed empty workspace/all-tab accessibility, actual activity processing/chart table/range, permission-filtered navigation/denied views and two Automations regressions. Its populated scenario reproduced the 375px custom-date overflow; the final focused rerun passed in **17.3s**, including four widths, table keyboard operation, range loading, custom dates, independent not-started states, degraded notices and retry.
- [Authenticated Analytics Lighthouse accessibility](lighthouse.json): **100**, no failed audits (Lighthouse 13.5.0).
- Production frontend build/restart: passed, healthy. Final smoke passed API readiness, frontend/sign-in and outbox → relay → queue → worker.
- No backend/domain/schema changes; the full Phase 11 database/security integration suite was not rerun for this UI checkpoint. Server-side financial permissions and provider-cost isolation remain unchanged. The narrowed session-response test proves UI gating, not a new server authorization grant.

Transient Playwright output, raw Lighthouse reports and browser profiles were removed after curating this evidence.

Stop for Analytics visual review before Integrations/Billing/Settings. No external deployment or Phase 11 closure.

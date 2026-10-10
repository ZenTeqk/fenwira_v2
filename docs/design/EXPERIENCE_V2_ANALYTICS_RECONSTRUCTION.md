# Analytics — Experience V2 reconstruction

8 October 2026. The user approved Automations and its right-panel phone preview and authorized the next module, EV2-09 Analytics. Reference: `experience-v2/08-Analytics.png`. Stop for Analytics visual review before Integrations/Billing/Settings.

## Reference decomposition and repository mapping

The reference has the approved light navigation/header, title with a date-range control, local Analytics navigation, a joined metric strip, a wide messaging visualization beside engagement rates, then campaign/team/automation panels. Existing AnalyticsFrame, MetricCard, TrendChart, DataTable, ModuleTabs and tenant-scoped useAnalytics queries supply these without new dependencies or endpoints.

All six routes retain their meaning: Overview, Messaging, Campaigns, Inbox, Automations and Usage. Usage requires billing.read; the other views require analytics.read. The existing filtered navigation catalog supplies the relocated links. Analytics now opts into the approved 224px sidebar/56px header variant; previously approved module compositions are unchanged.

## Implementation

AnalyticsFrame places the existing date controls alongside the title, followed by permission-filtered module links, the actual workspace-local range/comparison note and freshness/retention notices. The joined white metric strip uses an opt-in Analytics appearance of the shared MetricCard. Default cards and Home's compact appearance remain unchanged. Charts retain their original series, documented denominators, keyboard interaction and exact-value table alternatives. Panels use compact white surfaces with semantic tokens.

Overview retains its authoritative overview endpoint and adds the existing messaging and inbox queries using the same selected range and tenant query keys. Messaging supplies delivery/read progress indicators and inbound message counts. Inbox supplies median human first reply, current open conversations and current awaiting-first-response counts. Each supplemental endpoint has its own loading, retry, not-started and freshness states; missing data never becomes zero. The 375px custom-date regression exposed the header action group overflowing; Analytics scopes its header groups to the available width so From/To controls wrap. Changing ranges shows loading instead of temporarily presenting the previous range’s values as the newly selected range. A failed refresh of the main view displays a retry notice alongside its retained figures.

Campaign performance uses actual campaign names, sent counts and delivery rates with existing detail links. Automation performance uses actual top-flow names and execution counts. Links to the detailed Analytics views expose the existing richer reports.

## Intentional differences from the concept

- Overview keeps its existing sent/delivery/open/permission-filtered charge-or-failure metrics. Read rate and inbound message counts appear in engagement; inbound messages are not renamed customer replies or used to invent a reply rate.
- Campaign reply attribution, image thumbnails and reference sample values are not part of the Analytics contract. No fabricated artwork, statuses or counts.
- The overview top-flow contract supplies executions, not completion percentages. Rich outcomes remain in Automation analytics.
- Current awaiting-first-response counts are labelled accurately; no “waiting > 15 minutes” metric or first-response trend is invented.
- Date granularity remains daily; no inert Daily dropdown or unsupported aggregation mode.
- Null rates/durations remain “—”, with explanations. Zero denotes processed real data only.
- Existing customer-charge visibility remains server-owned. Provider cost and margin stay internal; no new financial data is requested or exposed.

## Boundaries and validation

No contracts, API/backend, database/RLS, workers, billing policies, subscription enforcement or commercial configuration are changed. The local screenshot response fixtures are test-only and do not persist financial or analytics history.

Concrete checks and captures are recorded in [Analytics visual review evidence](experience-v2/evidence/analytics-reconstruction/README.md). This checkpoint does not declare Experience V2 or Phase 11 closed.

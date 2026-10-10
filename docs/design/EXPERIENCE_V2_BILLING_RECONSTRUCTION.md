# Experience V2 — Billing wallet reconstruction

8 October 2026. Following the connector/density checkpoint, the user authorized the next screen. Billing follows `experience-v2/10-Billing.png` and the established compact workspace shell. Settings remains a separate review checkpoint.

## Composition and actual data

`/billing/wallet` presents a 20px Billing heading, contextual Subscription/Wallet/Usage links, a prominent available-balance surface, compact balance/reserved/calendar-month usage facts, full filterable ledger and a read-only subscription/support context. The desktop workspace uses a two-thirds ledger / one-third contextual column; smaller widths stack the context. Wide ledger data scrolls locally; the page does not overflow. Ledger pagination and CSV export remain available.

The wallet's backend state drives all warnings and badges; the frontend does not infer a funds state. Funding links use the configured support URL/email only. With no contact configured, the manual-funding explanation has no invented link. Effective features come from the existing Entitlements service response, not plan-name checks. Prices appear only when configured and otherwise say Contact us. Trial and current-period dates are actual subscription dates; no future period is synthesized.

The previously missing `/billing/usage` route now redirects to the existing `/analytics/usage` customer-charge view and retains its authorization.

## Reference differences

The wallet API has a single available balance. Ledger fund types preserve paid/promotional identity, but neither independent remaining balances nor a final promotional consumption policy exists. Do not sum a page of credits into a remaining fund balance. Replace those sample summaries with authoritative balance, reservations and monthly usage. Do not add expiry consumption or reinterpret metadata.

The reference's daily wallet bar chart, remaining-day forecast, funding recommendation and previous-period trends are omitted: a paginated ledger is not a complete daily series. The existing customer Usage screen is the supported deeper financial analysis. No invoice/GST, gateway, prices, discounts or provider costs are introduced. Subscription controls/state machine, financial ledger and rollout flags remain unchanged.

## Reuse and validation

Reuse DetailPage, Card, ModuleTabs, DataTable, FilterBar, StatusBadge, Alert and existing wallet/subscription/entitlement hooks. Existing subscription UI and domain services remain authoritative; the sidebar is read-only. Preserve the user's earlier branding, phone, chart and automation changes.

Extend the real manual-funding/ledger/filter/CSV browser regression and subscription regression. The separate presentation fixture checks 1440/1024/768/375, axe, configured/unconfigured support, low/insufficient/not-enforced states, unavailable wallet retry, effective feature confidentiality and Usage routing. Fixture screenshots do not claim persisted funding or subscription activation. Concrete results and actual local screenshots belong in `experience-v2/evidence/billing-reconstruction/README.md`.

Stop at Billing visual review before Settings. This checkpoint does not declare Phase 11 closure or enable subscription enforcement.

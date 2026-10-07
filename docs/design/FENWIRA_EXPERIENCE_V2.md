# Fenwira Experience V2

Approved direction: a calm, human WhatsApp communication workspace. Light sidebar, warm neutral workspace, white communication surfaces, restrained Enterprise Emerald. Existing domain/security behavior remains authoritative. [Implementation plan](EXPERIENCE_V2_IMPLEMENTATION_PLAN.md) maps all eleven approved local references and incremental scope.

## Foundation

Use one central theme in `packages/ui`, evolving Design System v1. Canvas #F7F7F4; sidebar #FAFAF8 / border #E7E7E2; surface white; subtle #F5F5F1; borders #E5E7E3 / #D6D9D4; primary text #18201D, secondary #4B5550. Emerald #00A884 / hover #008F70 / strong #007F64 / subtle #EAF7F2. WhatsApp #25D366 remains channel identity; success #16A34A remains semantic status, with accessible strong text. Warning/danger/info retain existing semantic meanings.

Screenshot muted #737C77 fails AA even on white (4.30:1). It is a decorative token only. Small metadata/placeholder text uses #66716B (5.07:1 on white, 4.73:1 on canvas). Primary-strong outlines clear non-text contrast on warm surfaces. No raw colors in feature code. Contrast tests are the executable contract.

Inter body 14/20, support 13/18, titles 24/32 semibold. Monospace for identifiers only. Existing 4px spacing scale; controls 8px, panels 12px, dialogs 16px. Borders establish hierarchy; minimal floating shadows, no gradients/glass/decorations. No new fonts/icon dependencies. Light mode only; reduced motion preserved.

## Shell and surfaces

232px light sidebar (64px optional icon rail), topbar workspace/search/help/notifications/account. Main modules: Home, Inbox, Contacts, Campaigns, Templates, Automations, Analytics; separate Integrations, Billing, Settings. Preserve permissions, shipped visibility, sub-pages in contextual navigation and deep links. Home remains `/dashboard`. Footer shows real WhatsApp/wallet state and member name/role. NOT_ENFORCED and financial permissions remain server-owned. No platform entry for tenant users.

Home is attention first, then recent communication/current campaigns and flow activity, secondary compact metrics. No KPI wall. Inbox is a communication workspace: views → avatar-led conversation rows → prominent message thread → lightweight context. White inbound bubbles, subtle emerald outbound, labelled neutral/warm internal notes, sender/timestamps/delivery visible. Do not expose CRM fields or unsupported actions.

## Responsive and accessibility

Check 1440/1024/768/375. Desktop optional rails yield space to thread at narrower widths; contact drawer below 1280; views inside list controls below 1024; mobile sequential conversation list/thread/details with back navigation. Wide data scrolls locally, never at page level. Keyboard/focus, names, dialog trapping/restoration, heading order, minimum 24px targets, labelled statuses and WCAG 2.2 AA remain required.

## Module migration and reference policy

References are visual composition guidance, not data/product contracts. Campaign images 05/06 are named opposite to their contents; map by contents. Existing brand assets remain authoritative. Real server data only; no fictional teams, AI, calls, third-party integrations, wallet forecasts, prices, tax/invoice/payment policy or provider cost in tenant views. Unsupported screenshot actions are omitted and documented. Preserve shared primitives, patterns, error/loading/empty/permission states and confirmations.

Contact lists stay communication-oriented with contextual inspection; templates become a message library; campaigns retain their real audience/template/personalization/schedule/review and reservation semantics; automations retain the existing engine/React Flow/accessible Outline; analytics retain definitions/freshness/retention and chart tables; Billing/Integrations/Settings inherit the foundation and later migrate compositions. `/platform` retains its separate privileged shell and commercial workflows.

**Checkpoint:** implement App Shell, Home, Inbox, test/report and stop for visual review before later module compositions. This checkpoint does not complete all Experience V2 or declare Phase 11 closure.

## Checkpoint history — approved foundation and Batch 2

The user approved the App Shell/Home/Inbox foundation and authorized EV2-05–07B. Contacts, Templates, Campaigns and Campaign Studio are now implemented in four separate increments. Preserve the foundation and stop again for visual/product review. See the [Batch 2 checkpoint](EXPERIENCE_V2_BATCH_2.md) and [implementation evidence](experience-v2/evidence/batch-2/README.md). Later modules remain pending; no aggregate Experience V2 or Phase 11 closure is declared.

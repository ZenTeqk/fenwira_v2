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

## Foundation visual-fidelity correction

The user requested a focused App Shell/Home/Inbox polish pass after identifying overly uniform icons, avatars and surfaces. Preserve all existing compositions and behaviors. Supporting color is intentional: compact semantic icon tints, deterministic human avatar tones, warmer thread canvas, clearer emerald outgoing messages and separately labelled warm internal notes. The three communication tokens and opt-in primitive appearances are specified in Design System v1. The new [visual-fidelity checkpoint](EXPERIENCE_V2_VISUAL_FIDELITY.md) compares the original references and retains before/after evidence. Other module compositions are outside this correction; stop for visual approval.

## Home reconstruction — visual approval pending

The current foundation, Batch 2 and subsequent correction are engineering foundations, **not visually approved**. The latest user direction restricts reconstruction to Home and shared shell elements visible there. Home is rebuilt from the actual 01-Home reference: attention/current updates at 70:30, recent communication beside campaign and secondary summary at 44:56, followed by a compact flow strip. Home alone uses a 240px sidebar, 64px topbar and 30/36 welcome heading; other module presentations remain unchanged. No propagation is authorized until Home visual review. See [reference decomposition, iterative comparison and validation](EXPERIENCE_V2_HOME_RECONSTRUCTION.md).

## Home visual direction approved — scale refinement

The user approved the reconstructed Home direction in `408dfd0`. This supersedes the Home visual-pending status above; it does not authorize propagation to Inbox or Batch 2. Preserve the composition, palette, surface hierarchy and real data. The current refinement uses 224px navigation, 36px nav rows/18px icons, 56px topbar, a 24/32 welcome heading, 16/24 sections and 14/20 body/row text. Home-only surfaces and 32px icons/avatars tighten density without global scaling. Existing 16px band gaps and 24px desktop gutters stay. [Scale/density evidence and validation](EXPERIENCE_V2_HOME_DENSITY.md) require their own visual checkpoint.

## Home scale approved — Inbox reconstruction checkpoint

The user approved the final Home density in `ef485de`; Home is now the canonical global Experience V2 language and must stay unchanged. Inbox alone is authorized for reconstruction: reuse the Home shell geometry, scale, palette and controls while following 02-Inbox for its four-pane communication composition. Desktop views/list/context target 176/320/256px, with the largest flexible area assigned to the thread. Preserve actual assignments, eligibility, locks, draft protection, real-time recovery and all server contracts. No queues, ticketing, AI, calls or fabricated counts. [Inbox decomposition, visual iteration and validation](EXPERIENCE_V2_INBOX_RECONSTRUCTION.md) have a separate visual checkpoint; do not propagate to Contacts or later modules.

## Inbox final fidelity — not visually approved

User review accepts the broad composition and necessary product differences, but requires a focused density/message-character pass. Keep Home and its shell unchanged. Reduce universal row metadata, consolidate thread header states, add original subtle texture, slightly enrich outbound surfaces, make the reply/note composer auto-grow and rebalance customer context. Preserve all real filters, individual assignment, eligibility, lifecycle, locking and messaging behavior. [Final-fidelity comparison and validation](EXPERIENCE_V2_INBOX_FINAL_FIDELITY.md) requires another user visual checkpoint; no propagation to later modules.

## Inbox views moved into list heading

The user subsequently requested removal of the separate 176px contextual Inbox rail. Its existing six filters now use an icon menu beside the current list heading at all widths, preserving queries and selected-state/keyboard semantics. List/context widths are unchanged; the 1440 thread grows from 424px to 608px using the reclaimed rail/gutter space. This focused refinement supersedes the earlier four-pane recommendation; Home and its shell stay unchanged. [Review evidence and verification](experience-v2/evidence/inbox-view-menu/README.md). Stop for visual review.

## Home and Inbox approved — Contacts reconstruction checkpoint

The latest user instructions visually approve Home and Inbox, including the compact Inbox view menu and customer-details toggle. They are the canonical workspace/communication implementations and remain unchanged. Contacts alone is reconstructed against `03-Contacts.png`: coherent directory surface, compact human rows, real filter shortcuts, inline desktop context and mobile cards/drawer. Reuse the existing approved shell variant for Contacts; retain actual fields, permissions, centralized eligibility and domain operations. [Decomposition, corrections and validation](EXPERIENCE_V2_CONTACTS_RECONSTRUCTION.md) have a separate visual review checkpoint. Stop after Contacts; no Templates/Campaigns reconstruction is authorized by this task.

## Templates checkpoint — approved Home, Inbox and Contacts foundation

The latest common implementation prompt approves all three foundation screens. They remain canonical and unchanged. Templates alone now follows `04-Templates.png`: compact status navigation/filter surface, message-library cards, actual lifecycle/sample information and an inline desktop context with responsive drawer. Existing template domain services and approved-version availability remain authoritative. [Templates decomposition and review evidence](EXPERIENCE_V2_TEMPLATES_RECONSTRUCTION.md). Ready for visual review; Campaigns and all subsequent checkpoints remain gated on that approval.

## Templates approved — Campaigns and Studio checkpoint

The user approved Templates and its recipient mobile preview, then authorized the next checkpoint. Campaigns operations follows `06-Campaign-studio.png`; Create Campaign follows `05-Campaign.png` (the reference filenames are reversed relative to their contents). Both reuse the approved 224px navigation/56px header and real domain behavior. Operations prioritizes active/scheduled cards and compact history; Studio combines saved steps, contextual campaign/template identity, recipient preview and an action footer. A Studio-only compact phone option reduces decorative wallpaper while leaving the approved Templates default unchanged.

[Campaigns decomposition and evidence](EXPERIENCE_V2_CAMPAIGNS_RECONSTRUCTION.md) records product differences, responsive checks and validation. Ready for visual review. Stop before Automations; earlier approved Home, Inbox, Contacts and Templates remain canonical.

## Campaigns operations — populated fidelity review

The user rejected the Campaigns list's visual fidelity and requested ten more demo campaigns against `06-Campaign-studio.png`. The new [populated fidelity checkpoint](experience-v2/evidence/campaigns-final-fidelity/README.md) brings image-led cards, inline status, message/audience hierarchy, progress/results, schedule band, five-row thumbnail history and working detail menus closer to that reference. Images come from existing frozen template samples, and audience labels from authorized catalogs. The demo uses actual persisted records and simulated WhatsApp. Preserve Create Campaign, all approved earlier screens and their shared shell; no unsupported reply metrics or bulk actions. Ready for visual review; stop before Automations.

## Campaigns API-driven reconstruction review

The latest instruction narrows the follow-up to Campaigns operations and reinforces actual customer data over reference sample values. Focused card/history/artwork/filter components, wrapping metadata, campaign-specific RUNNING semantics, safe loading errors and explicit scheduled navigation refine the existing implementation. All domain queries/actions, permissions and earlier approved screens remain authoritative. [Assessment and implementation](EXPERIENCE_V2_CAMPAIGNS_RECONSTRUCTION.md), [current validation evidence](experience-v2/evidence/campaigns-data-driven/README.md). Stop at Campaigns visual review.

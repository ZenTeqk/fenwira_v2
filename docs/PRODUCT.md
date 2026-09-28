# Fenwira — Product

## Scope

What Fenwira is, who it is for, what each module does, and what is deliberately out of scope for v2. This page also holds the consolidated open-questions register for all specs.

## Positioning

**Fenwira is the WhatsApp operations platform for growing businesses.** It connects a company's own WhatsApp Business number and gives the whole team one place to:

- talk to customers together (shared inbox)
- know who they are and what they agreed to (contacts and consent)
- reach them at scale (templates and campaigns)
- automate the routine (flows)
- see what it all costs and achieves (billing and analytics)

It is built for the Indian SMB and mid-market first (INR wallet, Asia/Kolkata defaults) but isn't India-specific.

**Principles**

1. **Trustworthy delivery.** A message is never silently lost or sent twice. Every status is visible.
2. **Consent-first.** Marketing without consent is blocked by the platform, not left to user discipline.
3. **Team-safe.** Agents never collide, bots never talk over humans, and tenants never see each other's data.
4. **Honest cost.** Every billable message is priced and ledgered, and tenants can always see why their balance changed.

## Personas

| Persona | Role | Goals | Primary modules |
| --- | --- | --- | --- |
| **Owner** (founder or business head) | OWNER | Connect WhatsApp, control spend and plan, own the workspace | Settings, Billing, Dashboard |
| **Admin** (ops lead) | ADMIN | Set up team, templates and integrations, keep things compliant | Settings, Templates, Integrations |
| **Manager** (support or marketing lead) | MANAGER | Run campaigns, supervise agents, build automations, read analytics | Campaigns, Automations, Analytics, Inbox |
| **Agent** (support or sales rep) | AGENT | Answer customers fast without stepping on colleagues | Inbox, Contacts |
| **Viewer** (stakeholder, auditor) | VIEWER | See performance and history, change nothing | Dashboard, Analytics |

## Navigation (frozen)

| Module | Sub-items | Purpose | Phase |
| --- | --- | --- | --- |
| **Dashboard** | | At-a-glance health: today's conversations, unassigned count, message delivery, campaign status, wallet balance, connection health. The landing page. | 2 (shell) → 11 (data) |
| **Inbox** | | Shared multi-agent inbox of WhatsApp conversations, with assignment, notes, templates, the service window and takeover | 7 |
| **Contacts** | All Contacts · Segments · Tags · Imports | Customer records with custom properties, tags, consent and a 360 view. Dynamic segments. CSV import and export. | 6 |
| **Campaigns** | Campaigns · Create Campaign · Analytics | Template broadcasts to segments, with consent filtering, scheduling, pacing, live stats and retry | 9 |
| **Templates** | Templates · Create Template | Build, validate, submit and track WhatsApp templates with a live preview and versioning | 8 |
| **Automations** | Flows · Flow Builder | Visual trigger → condition → action flows with versioning and inspectable execution history | 10 |
| **Analytics** | | Messaging, campaign, agent, automation and cost analytics over time | 11 |
| **Integrations** | WhatsApp · Webhooks · API | Connected numbers and health; outbound event webhooks; API keys | 4, 11 |
| **Billing** | Subscription · Wallet · Usage | Plan and entitlements, prepaid credits ledger, usage breakdown | 11 |
| **Settings** | Workspace · Team · Roles · WhatsApp · Security · Audit Logs | Workspace profile and policies, members and invitations, the role matrix, number management, personal and workspace security, the audit trail | 3, 4 |

*Settings → WhatsApp* and *Integrations → WhatsApp* show the same connection management. Settings is the admin entry point; Integrations is the discovery entry point.

## Glossary

| Term | Meaning |
| --- | --- |
| Workspace / Tenant | One customer organization. All data belongs to exactly one. |
| WABA | WhatsApp Business Account (Meta) that owns phone numbers and templates |
| Phone number | A WhatsApp sender number connected to Fenwira |
| Service window | 24 hours after the customer's last message, during which free-form replies are allowed |
| Template | A Meta-approved message format, required outside the service window |
| Takeover | A human agent has taken a conversation from automation |
| Consent | A recorded permission (or revocation) to message a contact for a purpose |
| Wallet | Prepaid credits that pay for billable WhatsApp messages |

## Out of scope for v2

Deals and pipelines, AI assistants or AI replies, other channels (SMS, email, Instagram), white-label branding, SSO/SAML, payment-provider checkout, a mobile app, and multi-language template groups. Any of these needs a spec change first.

## Product backlog

Deferred by the product owner; not scheduled in a phase.

| Item | From | Note |
| --- | --- | --- |
| One-tap / zero-tap authentication templates | Phase 8 | Copy-code OTP is built; one-tap needs the Android app signature. |
| Hide (archive) a template without deleting it at Meta | Phase 8 | The ARCHIVED status exists; no UI or endpoint. |
| Campaign send windows | Phase 9 | Pause dispatch outside set hours in the campaign timezone. |
| Retry failed recipients | Phase 9 | Re-send recipients FAILED with a retryable error (new idempotency suffix). |
| Individual-contact selection in the campaign wizard | Phase 9 | The API already accepts a CONTACTS audience source. |
| Inbox-message priority over campaign traffic | Phase 9 | Priority lanes in the outbound queue. |
| Low-balance notifications | Phase 9 | Planned in Phase 11 (P11-D1, PHASE_11_PLAN §2.3). |
| Campaign throughput optimization toward provider limits | Phase 9 | About 17/s measured locally vs Meta's 80 msg/s per number. |
| Advanced campaign template replacement/migration | Phase 9 (P9-D3) | v2 requires a new campaign instead. |
| Template picker: full first-use empty state | Design System v1 | Inline hint today (inside the send dialog). |
| Campaign wizard tag step: full empty state | Design System v1 | Inline hint today. |
| Campaign recipients: shared FilterBar | Design System v1 | Single status select today. |
| Audit logs: shared FilterBar | Design System v1 | Single action select today. |
| Automation Send Message: media in the builder form | Phase 10 / DS v1 | API and runtime support `mediaFileId`; the form handles text only. |
| Remove the `KpiCard` compatibility alias | Design System v1 | Use `MetricCard`. |

## Success metrics (Fenwira Core, Phases 0–7)

- A new tenant goes from registration to the first sent WhatsApp message in under 15 minutes, with no developer help.
- 0 lost and 0 duplicated messages in failure-injection tests.
- Webhook ingest p95 under 100 ms. Inbound message visible in the inbox in under 2 s p95.
- 0 cross-tenant access paths (the security test matrix passes).

---

## Decision register (specification frozen 2026-09-26)

The product owner resolved every question from the original register. These decisions are binding, and each spec reflects them. Changing one needs a new decision recorded here (and an ADR where it's architectural). ADR-0022 lists the ones that change architecture.

| # | Source | Decision |
| --- | --- | --- |
| A1 | ARCHITECTURE | No read replica in v2. Add one only when production database metrics justify it. |
| T1 | MULTI_TENANCY | No per-tenant data residency in v2. All tenants use the configured production region. |
| T2 | MULTI_TENANCY | Tenant deletion has a 30-day recoverable grace period, followed by purge or anonymization under the documented retention policy. No unrestricted database-wide hard delete. |
| D1 | DATABASE / SECURITY | No application-level column encryption for normal message content. Production uses encryption at rest and TLS in transit. Credentials, Meta tokens, secrets and equivalent authentication material are protected separately and never reach the browser or logs. |
| D2 | DATABASE | The normalized phone number is the contact deduplication identity within a tenant. No fuzzy deduplication. |
| S1 | SECURITY | No SSO/SAML in v2. |
| S2 | SECURITY | 2FA is optional by default. The architecture allows workspace-level enforcement. |
| API1 | API_SPEC | Maintain OpenAPI documentation. The external/public API is delivered in Phase 11. |
| M1 | MESSAGING_ENGINE | Typing indicators are optional, built only if the WhatsApp API reliably supports them, and never block Phase 7. |
| M2 | MESSAGING_ENGINE | Interactive messages may be sent from the inbox once core text, media and template messaging is stable. |
| MI1 | META_INTEGRATION | Meta Tech Provider production onboarding is not complete. Development uses the existing development/test Meta environment. Production onboarding is a separate business milestone. |
| MI2 | META_INTEGRATION | The CTWA 72-hour entry point is out of the initial v2 scope. The messaging architecture stays extensible for it. |
| MI3 | META_INTEGRATION | WhatsApp Business App coexistence is not an initial v2 requirement. |
| C1 | CONTACTS | No universal "UTILITY is allowed unless revoked" rule. Eligibility is evaluated by one centralized, purpose/category-aware consent and policy service. Marketing requires recorded consent/eligibility. |
| C2 | CONTACTS | No manual contact merge in v2. Duplicates are prevented mainly by the normalized phone number. |
| I1 | INBOX | Phase 7 assigns to individual agents. Teams/queues are deferred, and nothing may prevent adding them later. |
| I2 | INBOX | Lightweight canned/quick replies are part of Phase 7. Advanced shared reply libraries may come later. |
| TE1 | TEMPLATES | No multi-language template grouping. Each template/language is managed independently. |
| TE2 | TEMPLATES | Carousel and LTO template building are out of the initial v2 scope. |
| CE1 | CAMPAIGNS | No campaign A/B testing in v2. |
| CE2 | CAMPAIGNS | No recurring campaigns. Campaigns are immediate or one-time scheduled. |
| AE1 | AUTOMATION | No Wait-for-Reply node in the initial automation release. The execution model must allow durable waiting later. |
| AE2 | AUTOMATION | Deterministic priority-based execution replaces "oldest flow wins": each flow has a priority value, with a stable tie-break. |
| B1 | BILLING | Prices and entitlement values are configuration, never hard-coded in the application. Final pricing is decided before billing launch. |
| B2 | BILLING | Manual payment/top-up and invoicing operations in v2. A payment-provider integration waits until it's commercially needed. |
| B3 | BILLING | No unlimited negative wallet balance. New billable outbound operations are blocked when the usable balance is insufficient. Inbound messages, status updates and essential non-billable processing continue. Configurable credit limits must be possible later. |
| O1 | OBSERVABILITY | Operational alerts go to the configured operations email address. Alert routing stays extensible. |
| O2 | OBSERVABILITY | Structured logging with configurable retention. Production log storage and retention are decided in production infrastructure design. |
| DP1 | DEPLOYMENT | Docker Compose remains the deployment target. The production AWS architecture is finalized in production-readiness/migration work. |
| DS1 | DESIGN_SYSTEM | No dark mode in v2. Every component uses semantic tokens so dark mode can come later without redesigning the components. |
| T3 | MULTI_TENANCY | Only a workspace OWNER may restore a workspace during the 30-day grace period, and a workspace pending deletion is never purged. Final deletion disconnects/revokes Fenwira-managed Meta connections and credentials, purges tenant data and secrets under the deletion policy, and minimizes and anonymizes/pseudonymizes records that must be kept for legal, financial, billing, fraud-prevention, security or audit reasons. The purge is idempotent, auditable and safe to retry. Retention categories are documented separately (`DATA_RETENTION.md`). |
| C3 | CONTACTS | No permanent blanket rule for UTILITY or AUTHENTICATION. All outbound messaging passes through `MessageEligibilityService`, which can consider category, purpose, consent/opt-out, service window/context, Meta requirements, tenant policy, suppression/block state and other restrictions. MARKETING requires recorded marketing consent. Temporary behavior is marked and tested until the final policy matrix exists. |
| I3 | INBOX | Canned replies are workspace-shared (no personal replies in v2). OWNER, ADMIN and MANAGER create, edit, delete and use them; AGENT uses them; VIEWER can do neither. Fields: id, tenant_id, shortcut (for example `/hello`, unique per workspace), title, body, created_by, created_at, updated_at. They are tenant-isolated under RLS and security tests. |
| AE3 | AUTOMATION | All matching active automations may execute, one after another, in deterministic order (priority ascending, then created_at, then id), never concurrently for the same triggering event. Processing stops when an explicit condition requires it (for example human takeover). Execution history records the matched flows, their order, skipped and stopped flows, and the stop reason. |
| B4 | BILLING | Billable outbound messages use atomic reservations: available funds = wallet balance + permitted credit limit − active reservations. A reservation is taken atomically before a billable message is accepted, is idempotent per message, and is settled, released, reconciled or kept per the send lifecycle. A campaign that runs out of funds moves to `PAUSED_INSUFFICIENT_FUNDS`, keeps every recipient's state, shows the problem in the UI, and can resume once funds are available. |
| P9-D1 | BILLING | Tenant-level billing modes FREE, TRIAL and PREPAID (POSTPAID later, not v2). Production PREPAID tenants are enforced. New tenants can receive configurable trial/promotional credits. `BILLING_ENFORCED=false` stays the default for development and tests; the environment switch is not the tenant billing model. The billing UI stays in Phase 11. |
| P9-D2 | BILLING | Pricing stays configuration-driven and distinguishes provider (Meta) cost, the Fenwira customer charge, and adjustment/tax metadata. The current ₹0.88 / ₹0.13 values are labelled development placeholders; commercial pricing, markup, plans and GST/invoicing are set in Phase 11. |
| P11-D1 | BILLING | Low balance is a billing-domain state. The threshold is configuration (`billing.low_balance_threshold`; ₹100 is a documented development default, production sets it explicitly). The backend exposes the wallet state (NORMAL, LOW_BALANCE, INSUFFICIENT_FUNDS or equivalent) and the frontend renders it; one source drives the dashboard, Billing UI, notifications and operational alerts. No tenant-specific thresholds unless Phase 11 requirements justify them. (2026-09-28) |
| DS-v1 | DESIGN_SYSTEM | Design System v1 accepted (`ui-design-system-v1`, 9a0933d). Remaining UI debt is normal backlog. The form-control border treatment (1.48:1 boundary; labelled controls and a compliant focus indicator enforced) is accepted for v1. Phase 11 follows `docs/design/*` and the UI quality gate. (2026-09-28) |
| P11-D2 | BILLING | Customer plans STARTER, GROWTH, BUSINESS, all as data. Launch defaults (configuration, not constants): users 3 / 10 / 25; contacts 5,000 / 25,000 / 100,000; active flows 5 / 20 / 100. Other limits stay configurable and aren't invented. Feature access only through EntitlementsService. |
| P11-D3 | BILLING | Monthly subscriptions at launch; the model may support annual; no annual discount. |
| P11-D4 | BILLING | Subscription prices are not approved; pricing stays configuration and a separate commercial review sets it. |
| P11-D5 | BILLING | 14-day trial with Growth-equivalent entitlements unless configured otherwise, represented through entitlement resolution (no plan-name checks). |
| P11-D6 | BILLING | Trial expiry deletes nothing; customer-initiated billable outbound and gated paid capabilities stop; inbound and status processing continue; the OWNER can review the workspace and choose a plan. |
| P11-D7 | BILLING | Configurable promotional/trial credits in the immutable ledger, auditable and distinguishable from paid funds; expiry metadata designed, no expiry policy invented. |
| P11-D8 | BILLING | INR at launch; currency-aware schema; no multi-currency conversion in Phase 11. |
| P11-D9 | BILLING | Billing modes FREE (explicitly configured internal/development/promotional), TRIAL, PREPAID (normal paying customers); POSTPAID later; mode is never derived from the plan. |
| P11-D10 | BILLING | Provider (Meta) cost and Fenwira's customer charge are recorded separately and answer independently. |
| P11-D11 | BILLING | No permanent markup approved; customer charge stays configuration-driven; provider cost, markup/platform component, tax metadata and final charge stay separately representable. |
| P11-D12 | BILLING | Low-balance production default ₹100 as configuration (`billing.low_balance_threshold`); the backend returns NORMAL / LOW_BALANCE / INSUFFICIENT_FUNDS / NOT_ENFORCED; the frontend never compares amounts. Supersedes the value part of P11-D1. |
| P11-D13 | BILLING | Manual top-ups at launch, by platform operators, with reason/reference, idempotency and immutable audit. |
| P11-D14 | BILLING | No final GST/invoice rules; the domain keeps tax metadata and can add invoice records; production tax invoices need accounting validation first. |
| P11-D15 | ANALYTICS | Analytics retention defaults 30 / 90 / 365 days (STARTER / GROWTH / BUSINESS) via entitlements; financial, audit and legal retention are separate and never purged by analytics retention. |
| P11-D16 | BILLING | Downgrades never delete data; over-limit resources are marked; user-initiated growth of a constrained resource is blocked; inbound messages and inbound-created contacts are always accepted; active flows are preserved and not randomly disabled; a configurable grace mechanism covers already-active capabilities. |
| P11-D17 | SECURITY | PLATFORM_OPERATOR, separate from tenant roles: CLI-granted, mandatory 2FA, separate protected area, short privileged sessions, audited financial operations with reason/reference and idempotency, least privilege, no customer-data browsing, no separate admin app. |
| P11-D18 | API | API and outbound webhooks available to GROWTH and BUSINESS through entitlements; scoped API keys; the smallest public route allowlist (PHASE_11_PLAN §5.1a); signed webhook deliveries with retries, history and the SSRF-safe client. |
| P11-D19 | BILLING | Payment gateway deferred; manual payments at launch; the domain stays gateway-neutral. |
| P11-D20 | BILLING | The billing/support contact is configuration (`billing.support_email`, `billing.support_url`), never hard-coded. Unset → the non-clickable "Contact Fenwira to arrange a top-up" fallback; set → a "Contact billing" action on the Wallet page and the contact in billing emails. No self-service top-up or payment flow. |
| P11-D21 | BILLING | An unfunded wallet's first credit is initial funding (`wallet.funded`), never "balance restored". `wallet.recovered` means a funded wallet crossing back to NORMAL (from INSUFFICIENT_FUNDS or LOW_BALANCE). Initializing a wallet row notifies nobody; transition events stay idempotent. |
| P9-D3 | CAMPAIGNS | A template that becomes unavailable mid-campaign pauses it as PAUSED_TEMPLATE_UNAVAILABLE, never FAILED. Processed recipients keep their states; the rest are preserved and not sent. The same campaign can't switch templates; a new campaign is created instead. Which template version produced each message stays auditable. |

## Open questions register

Open, owned by the product owner; none blocks Phase 11 Steps 1–5 (details in `plans/PHASE_11_PLAN.md` §10):

| # | Question | Blocks |
| --- | --- | --- |
| P11-Q20 | Subscription prices per plan | Charging subscriptions |
| P11-Q21 | Permanent usage markup / production customer price book | Production price book (placeholders flagged) |
| P11-Q22 | GST and invoice rules | Issuing tax invoices |
| P11-Q23 | Promotional credit spend order and expiry policy | Applying spend order/expiry (credits are recorded and shown as granted) |
| P11-Q24 | Downgrade grace duration and end-of-grace behavior | Automatic changes after a downgrade (none happen today) |
| P11-Q25 | Whether tenants see provider (Meta) cost | Tenant usage view (shows the customer charge only) |

A new question is added here, with its owner and the work it blocks, instead of being settled by an implementation assumption.

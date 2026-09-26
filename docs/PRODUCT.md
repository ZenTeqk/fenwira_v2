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

## Open questions register

Details the decisions above left undecided. Nothing here may be settled by an implementation assumption: the affected work waits, or is built so the answer can be plugged in.

| # | Source | Question | Blocks | Owner |
| --- | --- | --- | --- | --- |
| T3 | MULTI_TENANCY (T2) | Tenant deletion details: (a) who can restore a workspace during the grace period, and how; (b) which records are anonymized and kept after purge (for example the wallet ledger, usage events and audit logs, for finance and legal) and which are deleted; (c) whether connected numbers are disconnected at deletion or at purge. | The tenant purge job | Product/Legal/Finance |
| C3 | CONTACTS (C1) | The eligibility policy for UTILITY and AUTHENTICATION messages: what recorded consent or opt-in each requires, and whether it depends on the template category or the service window. | Replacing the interim UTILITY check in the policy service | Legal |
| I3 | INBOX (I2) | Canned replies: are they personal, workspace-shared, or both, and which permission manages the shared ones? | The Phase 7 canned-replies build | Product |
| AE3 | AUTOMATION (AE2) | When several flows match one event, does only the highest-priority flow start (as today), or do all matching flows run in priority order? | Phase 10 triggering | Product |
| B4 | BILLING (B3) | How in-flight billable sends count against the usable balance so concurrent sends can't exceed the credit limit (a hold at accept time, or a check against an estimate), and what a running campaign does when a send is refused (pause, or fail the remaining recipients). | Phase 11 balance enforcement | Eng/Business |

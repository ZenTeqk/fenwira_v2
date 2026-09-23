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

## Open questions register

Every open question from every spec, in one place. Until an item is answered, the listed **assumption** stands and is what gets built.

| # | Source | Question | Assumption until answered | Owner |
| --- | --- | --- | --- | --- |
| A1 | ARCHITECTURE | Read replica before Phase 12? | No | Eng |
| T1 | MULTI_TENANCY | Per-tenant data residency? | Out of scope | Product |
| T2 | MULTI_TENANCY | Tenant deletion: hard delete or anonymized archive? | Hard delete after a 30-day grace period | Product/Legal |
| D1 | DATABASE | Column-level encryption of message content? | No (disk encryption in production) | Security |
| D2 | DATABASE | Contact dedupe beyond phone? | Phone only | Product |
| S1 | SECURITY | SSO/SAML for Business? | No | Product |
| S2 | SECURITY | `require_2fa` on by default? | Off | Product |
| API1 | API_SPEC | Public OpenAPI doc in Phase 11? | Yes | Eng |
| M1 | MESSAGING_ENGINE | Typing indicators in the inbox? | Yes, if the API supports it | Product |
| M2 | MESSAGING_ENGINE | Interactive (buttons/list) messages from the inbox? | Automation only | Product |
| MI1 | META_INTEGRATION | Meta Tech Provider onboarding and business verification done? | **Not done.** Phase 4 uses dev connect until it is. | Business |
| MI2 | META_INTEGRATION | 72-hour free entry point window (CTWA)? | No | Product |
| MI3 | META_INTEGRATION | Coexistence with the WhatsApp Business app? | No | Product |
| C1 | CONTACTS | UTILITY consent rule acceptable? | Allowed unless explicitly revoked | Legal |
| C2 | CONTACTS | Contact merge? | No | Product |
| I1 | INBOX | Agent teams or queues? | No; assign to individuals | Product |
| I2 | INBOX | Canned responses? | Not in Phase 7 | Product |
| TE1 | TEMPLATES | Multi-language template groups? | No | Product |
| TE2 | TEMPLATES | Carousel / LTO templates? | No | Product |
| CE1 | CAMPAIGNS | A/B testing? | No | Product |
| CE2 | CAMPAIGNS | Recurring campaigns? | No | Product |
| AE1 | AUTOMATION | "Wait for reply" node? | No (top candidate for v1.1) | Product |
| AE2 | AUTOMATION | Configurable flow priority? | Oldest flow wins | Product |
| B1 | BILLING | Plan prices and entitlement values? | Placeholders in `BILLING.md` | Business |
| B2 | BILLING | Payment provider and GST invoicing? | Manual in v2 | Business/Finance |
| B3 | BILLING | Overdraft cap? | No cap. A negative balance blocks launches only. | Business |
| O1 | OBSERVABILITY | Alert routing destination? | Email to the ops address | Ops |
| O2 | OBSERVABILITY | Production log retention and destination? | Decided at the production migration | Ops |
| DP1 | DEPLOYMENT | Production host? | After Phase 12 | Ops |
| DS1 | DESIGN_SYSTEM | Dark mode in v2? | No; tokens allow it later | Product |

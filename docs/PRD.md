# Product Requirements (PRD)

## Scope

User stories with acceptance criteria per module, grouped by phase. The technical detail lives in the module specs linked from each section. The phase prompts in `docs/prompts/` add the engineering acceptance tests.

## Decisions

Story format: **As a** role, **I want** capability, **so that** outcome. The criteria are testable statements.

---

## Phase 2 — Application shell

**SH-1.** As any user, I want a consistent sidebar and header, so that I always know where I am.

- The sidebar shows the frozen navigation, hiding modules not yet shipped. The active item is highlighted in primary.
- The header shows breadcrumbs, a ⌘K command palette, notifications (from Phase 7) and a user menu.
- It works at 375 px (the sidebar becomes a drawer) without horizontal scroll.

## Phase 3 — Identity, workspaces, team

**AU-1.** As a new visitor, I want to register and create a workspace, so that I can start using Fenwira.

- Register with name, email and password → a verification email arrives → the link verifies → create a workspace (name, country, timezone) → I become OWNER → I land on the Dashboard.
- An unverified user can't create a workspace. The verification link expires after 24 hours and can be resent.

**AU-2.** As a user, I want to log in securely, with optional 2FA.

- Wrong credentials show one generic error. After 5 failed attempts in a minute, login is rate-limited.
- With 2FA enabled, login asks for a TOTP or backup code. Setup shows a QR code and 10 backup codes once.

**AU-3.** As a user, I want to reset a forgotten password.

- The reset link expires after 1 hour and works once. Resetting logs out all other sessions.

**AU-4.** As a user in several workspaces, I want to switch between them from the sidebar.

- Switching changes all data shown. The last-used workspace is remembered per browser.

**TM-1.** As an Admin, I want to invite teammates with a role.

- Invite by email and role (not above my own). The invitee gets an email and joins with a new or existing account. Pending invites can be resent or revoked and expire after 7 days.

**TM-2.** As an Admin, I want to change roles and deactivate members.

- A deactivated member loses access immediately (their sessions for that workspace are rejected). There is always exactly one Owner. Ownership transfer is Owner-only.

**SE-1.** As a user, I want to see and revoke my active sessions.

**AL-1.** As an Admin, I want an audit log of sensitive actions, filterable by actor, action and date.

## Phase 4 — WhatsApp connection

**WA-1.** As an Admin, I want to connect our WhatsApp Business number, so that Fenwira can send and receive messages.

- Settings → WhatsApp → Connect opens Meta's signup. After finishing it, I see progress through each step and end at **Connected**.
- If a step fails, I see which step and a Retry button. No developer is needed.
- A number already connected to another workspace is rejected with a clear message.

**WA-2.** As an Admin, I want to see connection health.

- Each number shows phone, connection, webhook, quality, messaging tier and last sync. A RED quality rating or an invalid token shows a warning banner and notifies admins.

**WA-3.** As an Admin, I want to test a connection by sending a test message to my own phone.

**WA-4.** As an Admin, I want to disconnect a number or rotate its token, with confirmation.

## Phase 5 — Messaging foundation

**MS-1.** As the business, we want every customer message received exactly once, even if Meta retries.

**MS-2.** As an agent, I want to see each outbound message's status (sending, sent, delivered, read, failed), with the reason when it failed.

**MS-3.** As the business, we want temporary Meta errors retried automatically and permanent errors reported clearly.

## Phase 6 — Contacts & consent

**CT-1.** As an Agent, I want to create and edit contacts, with the phone validated and normalized.

- Invalid numbers are rejected with the reason. A duplicate phone links to the existing contact.

**CT-2.** As a Manager, I want to filter contacts by any field, tag, custom property or consent state, and save the filter as a segment.

- A segment shows a live count. Filters combine AND/OR groups.

**CT-3.** As a Manager, I want to import contacts from CSV.

- Upload → map columns (suggested automatically) → see validation errors and duplicates → preview → import → progress → summary with a downloadable error file. Imports of up to 100k rows are supported.

**CT-4.** As a Manager, I want to export the current filtered list to CSV.

**CT-5.** As an Admin, I want to define custom contact fields (text, number, date, yes/no, choice).

**CN-1.** As the business, we want customers who reply STOP to be unsubscribed from marketing automatically, with evidence recorded.

**CN-2.** As an Admin, I want each contact's full consent history, showing who or what changed it, when, and the evidence.

**CN-3.** As the business, we want marketing messages to contacts without consent blocked by the system.

**CT-6.** As an Agent, I want a Contact 360 page with overview, conversations, campaigns, activities, consent and notes.

## Phase 7 — Inbox

**IN-1.** As an Agent, I want new customer messages to appear instantly, with unread counts.

**IN-2.** As an Agent, I want to reply with text, attachments or templates.

- When the 24-hour window is closed, only templates are offered, with an explanation. A countdown shows the time left in the window.

**IN-3.** As an Agent, I want to assign conversations to myself, and as a Manager, to anyone.

- Optional round-robin auto-assignment to online agents.

**IN-4.** As an Agent, I want to see that a colleague is already replying, so that we don't both answer.

- Only one person can send at a time. Others see "X is replying…".

**IN-5.** As an Agent, I want to take over from the bot, so that automation stops messaging while I handle the customer.

- Replying takes over automatically. A banner shows the takeover state, with "Return to automation".

**IN-6.** As an Agent, I want internal notes that customers never see.

**IN-7.** As an Agent, I want to resolve, snooze and reopen conversations, and to filter by Mine / Unassigned / All / Takeover / Resolved.

**IN-8.** As an Agent, I want to search conversations by message text, name or phone.

**IN-9.** As an Agent, I want to see the customer's profile, consent and tags beside the chat.

## Phase 8 — Templates

**TP-1.** As a Manager, I want to build a template with header, body, footer, buttons and variables, with a live WhatsApp preview.

**TP-2.** As a Manager, I want validation that catches Meta's rules before submission.

**TP-3.** As a Manager, I want to submit a template and track its approval, and to see the rejection reason when it is rejected.

**TP-4.** As a Manager, I want to edit an approved template without breaking the version in use.

**TP-5.** As an Admin, I want to import templates that already exist in our Meta account.

## Phase 9 — Campaigns

**CA-1.** As a Manager, I want to create a campaign in 6 steps: Audience → Template → Variables → Schedule → Review → Launch.

**CA-2.** As a Manager, I want to see before launch how many contacts will be skipped and why (no consent, invalid, duplicate), plus the estimated cost.

**CA-3.** As a Manager, I want to schedule a campaign in my timezone, optionally within sending hours.

**CA-4.** As a Manager, I want to pause, resume, stop and retry failed recipients without anyone getting a message twice.

**CA-5.** As a Manager, I want live stats (sent, delivered, read, failed, skipped) and failure reasons.

## Phase 10 — Automations

**AT-1.** As a Manager, I want to build a flow visually: a trigger, conditions with yes/no branches, and actions.

**AT-2.** As an Admin, I want to publish a flow only when it is valid, with the problems highlighted on the canvas.

**AT-3.** As a Manager, I want to edit a live flow safely. Edits become a new version, and conversations in progress finish on the old one.

**AT-4.** As a Manager, I want to inspect any execution step by step, and see why it failed.

**AT-5.** As a Manager, I want to pause a flow instantly.

**AT-6.** As the business, we want automations to never message a customer while an agent has taken over.

## Phase 11 — Billing, analytics, developer

**BI-1.** As an Owner, I want to see my plan, its limits and my current usage.

**BI-2.** As an Owner, I want to see my credit balance, this month's spend, and every transaction that changed the balance.

**BI-3.** As an Owner, I want a notification when credits run low.

**BI-4.** As the business, we want limits enforced by plan, with a clear upgrade prompt.

**AN-1.** As a Manager, I want analytics on messages (delivery, read and failure rates), campaigns, agent response times, conversation volume, automations and cost, over a chosen date range.

**DV-1.** As an Admin, I want to create API keys with specific scopes, revoke them, and see when they were last used.

**DV-2.** As an Admin, I want to receive Fenwira events at our own webhook URL, with signatures and a delivery log.

## Phase 12 — Production readiness

Non-functional. See `docs/prompts/PHASE_12_HARDENING.md` and `OBSERVABILITY.md`.

## Open questions

Product-level open questions are consolidated in the register at the bottom of `PRODUCT.md`.

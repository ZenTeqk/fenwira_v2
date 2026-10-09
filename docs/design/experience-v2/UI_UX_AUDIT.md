# Experience V2 — UI/UX audit (nine in-scope screens)

8 October 2026. Scope: Home, Inbox, Contacts, Templates, Campaigns list, Create campaign, Automations, Analytics, Integrations. Billing, Subscription, Wallet and Settings were not audited or changed.

Method: one synthetic local workspace ("Acme Electronics", mock Meta only) was seeded through the domain APIs by [`apps/web/e2e/ui-ux-audit.spec.ts`](../../../apps/web/e2e/ui-ux-audit.spec.ts) (opt-in: `UI_AUDIT_PHASE=before|after`, optional `UI_AUDIT_ONLY=01,02`). Each screen was captured at 1440 × 1000 and checked at 1440/1280/1024/768/390 for page overflow, axe WCAG 2.2 AA and console errors, then compared by eye with the approved references in this folder. Evidence: [`evidence/ui-ux-audit/`](evidence/ui-ux-audit/README.md).

Reference note: `05-Campaign.png` shows **Create campaign** and `06-Campaign-studio.png` shows the **Campaigns list** (file names are swapped).

Classification: V1 visual styling · V2 layout · V3 API data presented incorrectly · UX1 usability · B1 missing backend capability · D1 intentional difference · R1 illustrative reference data. Severity: High / Medium / Low.

## Baseline automated result

Before and after, every screen at every width: no page-level horizontal overflow, no axe WCAG 2.2 AA violations, no browser console errors. The findings below are visual and usability findings.

## Shared (P0)

| ID | Finding | Class | Sev | Decision |
| --- | --- | --- | --- | --- |
| S1 | Phone numbers rendered as raw E.164 (`+919499881000`) in Inbox context, Contacts table, Contacts mobile row and Contacts panel; reference groups digits (`+91 98765 43210`). | V3 | Medium | **Fixed.** `lib/phone.ts` `formatPhone` groups only unambiguous plans (+91, +1), else returns the stored value; display only (unit-tested). Inbox context drops `font-mono` for tabular figures. |
| S2 | Integrations section headings at 14px, smaller than the 16px card titles inside them; other modules use 16px `text-md` section headings. | V1 | Low | **Fixed.** Aligned to `text-md font-semibold text-slate`. |
| S3 | Templates/Campaigns/Automations/Analytics/Integrations titles are 20px, Home/Inbox/Contacts 24px. | D1 | — | **Preserved.** User-requested module density (8 Oct, `EXPERIENCE_V2_MODULE_DENSITY.md`). Note: that doc states 14px descriptions; the shell applies `text-sm` (13px). Recorded, not changed. |
| S4 | Muted text `#66716B` instead of reference `#737C77`. | D1 | — | **Preserved.** Accessible contrast on the warm canvas (`#737C77` remains `muted-decorative`). |
| S5 | Sidebar unread count is a filled emerald pill; reference uses a neutral pill. Top bar Help is icon-only; avatar has no chevron. | D1 | Low | **Preserved.** Stronger unread signal; icon buttons have accessible names. |
| S6 | Sidebar 224px, 14px navigation, 18px icons, 56px top bar, warm canvas, white surfaces, light navigation. | — | — | Already consistent with the reference and between screens; **not changed**. |

## Home

| ID | Finding | Class | Sev | Decision |
| --- | --- | --- | --- | --- |
| H1 | "Needs attention" stretches to the Activity column; with one item it shows a large blank card. | UX1 | Medium | **Partly fixed.** Short lists (< 3) end with a true "Nothing else needs your attention" status (only when nothing failed or is loading). Equal-height rows still leave white space below a short list (remaining, Low). |
| H2 | Scheduled campaign summary said "0 recipients" (audience is snapshotted at launch). | V3 | Medium | **Fixed.** Shows recipients once snapshotted, otherwise the existing audience label ("4 selected contacts"), matching the Campaigns list. |
| H3 | Recent conversations show `Template: service_reminder` for template messages; reference shows message text. | B1 | Low | Preview string is produced by the API mapper (`messaging.mapper.ts`). Documented. |
| H4 | "Good morning" greeting, Today sparklines, unified event feed and execution counts in reference. | R1/D1 | — | Real data and previously documented Home decisions retained. |

## Inbox

| ID | Finding | Class | Sev | Decision |
| --- | --- | --- | --- | --- |
| I1 | Raw phone in contact context. | V3 | Medium | **Fixed** (S1). |
| I2 | Separate views column in reference; implementation uses a views menu beside the list heading. | D1 | — | Preserved (user-requested 7 Oct). |
| I3 | Thread header masks the number (`•••• 1000`). | D1 | — | Preserved (privacy decision). |
| I4 | Typing indicator, voice-note waveform, product cards, Call action, teams. | B1/R1 | — | Not supported by the API or not part of the product; not invented. |
| I5 | Selected row, unread counts, bubbles, delivery ticks, service window, takeover banner, composer, note mode, 390px sequential flow. | — | — | Verified working; no change. |

## Contacts

| ID | Finding | Class | Sev | Decision |
| --- | --- | --- | --- | --- |
| C1 | "Assigned" column clipped "Unassign…" (96px cap). | V2 | Medium | **Fixed.** `min-w-28 max-w-36`; long teammate names still truncate. |
| C2 | Raw phone in table, mobile row and panel. | V3 | Medium | **Fixed** (S1). |
| C3 | WhatsApp column shows two lines (service replies + marketing) instead of one chip. | D1 | — | Preserved: two independent, real eligibility verdicts. |
| C4 | Panel "Recent conversations" renders the last message as a three-line green link. | V1 | Low | Remaining. |

## Templates

| ID | Finding | Class | Sev | Decision |
| --- | --- | --- | --- | --- |
| T1 | Cards title templates by their WhatsApp name (`festive_offer`), reference uses "Festive Offer". | D1 | — | Preserved: Meta's identifier is authoritative and is what operators search for. |
| T2 | Detail panel "Open Inbox" (ghost) wrapped onto its own line and read as stray text. | UX1 | Low | **Fixed.** Link-style action with arrow. |
| T3 | Panel shows status on a separate line with a gap below the name; phone preview truncates the business name in the 288px pane. | V1 | Low | Remaining (288px pane is a user-approved density decision). |
| T4 | "Used in N campaigns / N times" counts. | B1 | — | No usage endpoint. |
| T5 | Before capture had no selected template; the after capture adds the selected/detail state. | — | — | Evidence note. |

## Campaigns — list

| ID | Finding | Class | Sev | Decision |
| --- | --- | --- | --- | --- |
| CL1 | "Campaign analytics" header action rendered as plain text (ghost) next to the primary button. | UX1 | Medium | **Fixed.** Secondary button with chart icon (matches Templates' "Sync with WhatsApp"). |
| CL2 | Card summary showed raw `{{1}}`. | V3 | Medium | **Fixed.** `campaignBodyPreview` shows mapped sources (`Hi [First name] 👋`, static values inline); unmapped stay as written (unit-tested). |
| CL3 | Replies column and per-campaign reply counts. | B1 | — | Campaign stats contract has no reply attribution. |
| CL4 | Artwork only when the template has an image header; otherwise the campaign icon tile. | R1 | — | Real data. |

## Campaigns — create

| ID | Finding | Class | Sev | Decision |
| --- | --- | --- | --- | --- |
| CC1 | Stepper, selected template, personalization, audience estimate, phone preview, campaign summary and bottom actions match the reference composition at step 3. | — | — | No change. Safeguards (save-on-continue, estimate, launch confirmation) untouched. |
| CC2 | Variable label "Message {{1}}: value" is technical. | UX1 | Low | Remaining. |

## Automations

| ID | Finding | Class | Sev | Decision |
| --- | --- | --- | --- | --- |
| A1 | A flow whose editor `layout` is missing (the contract defaults it to `{}`) rendered every node at the origin: only "End" was visible and the minimap was blank. | V3 | **High** | **Fixed.** Unplaced nodes get a display-only dagre position (the existing `autoLayout`); nothing is persisted until the user moves or tidies. |
| A2 | The 200 × 150 minimap covered nodes on the user-approved compact canvas. | V2 | Medium | **Fixed.** 120 × 80 (reference scale). |
| A3 | Initial fit shrank step text to illegibility and centred tall flows, cutting off the trigger. | UX1 | Medium | **Fixed.** Initial fit keeps zoom ≥ 0.75 and opens tall flows at the trigger; Fit view control still shows the whole flow. |
| A4 | Runs today / completed / need attention header metrics, Test action. | B1/D1 | — | Not provided per flow in the reference form; existing executions/history retained. |

## Analytics

| ID | Finding | Class | Sev | Decision |
| --- | --- | --- | --- | --- |
| AN1 | X-axis labels collided ("7 Oc8 Oct"): the last label was always forced next to a sampled one. | V2 | Medium | **Fixed** in shared `TrendChart`: at most eight labels ≥ ~64px apart; a sampled label within one interval of the last is dropped. |
| AN2 | A zero "Failed" series was drawn last, painting red over the baseline as if messages failed. | UX1 | Medium | **Fixed.** Lines draw in reverse legend order so the primary series stays on top. |
| AN3 | Row height equalisation leaves space under Messaging activity. | V2 | Low | Remaining. |
| AN4 | Daily/weekly selector, per-automation completion rates, trend deltas on every metric. | B1/D1 | — | Documented in the Analytics reconstruction; not invented. Provider cost never shown. |

## Integrations

| ID | Finding | Class | Sev | Decision |
| --- | --- | --- | --- | --- |
| IN1 | Section heading hierarchy (S2). | V1 | Low | **Fixed.** |
| IN2 | Slack, Teams, Activepieces, custom integration tiles. | B1/D1 | — | Not shown as operational; only the four supported connectors appear, OAuth ones disabled until configured. |
| IN3 | WhatsApp connection, quality, webhook, API keys, endpoints table. | — | — | Verified real data; no change. |

## Not changed, deliberately

Font sizes, icon sizes, sidebar and top bar dimensions, page padding and component density were already consistent and readable; they were kept. No backend, contract, schema, billing or settings file was modified.

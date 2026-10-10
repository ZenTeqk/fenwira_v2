# Experience V2 — backend-dependent UI capabilities

8 October 2026. Reference elements that the frontend cannot represent truthfully without backend support. None were implemented or simulated; screens show real data or nothing.

| Screen | Reference element | Missing capability | Current UI |
| --- | --- | --- | --- |
| Home, Inbox | Template message previews read as message text | `messaging.mapper.ts` returns `Template: <name>` as the conversation preview | Shows the API preview string |
| Inbox | "Priya is typing…" and list "typing…" | No typing events from the WhatsApp Cloud API or realtime gateway | Not shown |
| Inbox | Voice-note waveform, product/catalogue cards | Media types beyond the current sendable/received set; no catalogue integration | Existing media rendering only |
| Inbox | Call action, teams (Sales/Support/Orders) | No calling; no team entity | Not shown |
| Campaigns list, Analytics | Replies column / per-campaign replies | Campaign stats have no reply attribution | Sent/Delivered/Read only |
| Templates | "Used in N campaigns", "Used N times" | No template usage aggregation endpoint | Not shown |
| Automations | Runs today, % completed, "need attention" counts in the studio header | Per-flow execution aggregates for a period | Total and running executions |
| Automations | "Test" run action | No dry-run execution endpoint | History only |
| Analytics | Daily/Weekly granularity selector | Aggregation is daily only | No inert selector |
| Integrations | Slack, Microsoft Teams, Activepieces, custom integration tiles | Not supported connectors | Only supported connectors; OAuth ones disabled until configured |

Recommended next step: product decides which of these are worth APIs (campaign replies and the template preview text are the most visible), then each is specified in `docs/` before implementation.

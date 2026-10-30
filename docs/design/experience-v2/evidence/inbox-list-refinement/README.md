# Conversation-list refinement — 30 October 2026

Implements the supplied refinement specification in the existing inbox, preserving the original
application navigation, 320px list/customer panels at 1440px, messaging paths and permission gates.

- Compact heading/search, neutral segmented views and 32px status/unread controls.
- Agent takeover in the advanced menu, with a removable active chip and existing combinations.
- 76px minimum rows, 36px stable pastel avatars, 14px names, one-line 13px previews and 12px clocks.
- Inset rounded mint selection, short 3px indicator, separate focus outline and quieter hover.
- Full-name tooltips and narrow generated-name numbering; missing names retain phone fallback.
- Preview formatter uses actual stored summaries and already-loaded matching thread messages.
- Compact system events retain wording/order/history. The single-border amber closed-window
  notice retains Choose template and stacks its action within narrow composer containers.
- Customer details use the existing drawer below 1280px so reopening them does not cramp chat.

## Data limitations

The conversation summary API has no latest-message direction, type, delivery status, rendered
template body or contact-photo field. Unloaded rows use its truthful summary and a readable
template-name fallback; no sender, failure, variable value or photo is invented. Matching cached
threads add rendered template excerpts, media filenames/captions, direction and delivery state.
Existing tenant-scoped message events update those caches without per-row history requests.
Search snippets keep priority and are not attributed to the latest sender. Advanced takeover
counts stay hidden because the existing counts endpoint does not support that filter.

## Rendered review

Browser-only fixtures supply sample names/messages; they are not product data. The running UI
was visually inspected at 1440px and 375px, including the list, selected failed document and
compact closed-window notice. Screenshots include:

- [Desktop inbox](inbox-1440.png)
- [Phone list](refined-list-375.png)
- [Rendered template preview](rendered-template-preview-1440.png)
- [Failed document preview](failed-document-preview-1440.png)
- [Phone closed-window notice](compact-closed-window-375.png)

## Verification

The browser scenarios cover control containment and large/zero counts, long names/filenames,
combined view/status/unread/takeover/search queries, pagination, stable avatars, keyboard focus
without mark-read, no per-row history requests, real stored previews, full system-event history,
closed-window template selection, responsive details and WCAG A/AA checks. Pure preview tests
cover stale/missing data, search priority, frozen/unresolved template text, media, failures and
narrow generated-name detection. Real messaging scenarios check live list previews and receipts.

Final results: `pnpm lint`, `pnpm typecheck` and `pnpm test` pass (578 unit tests, including
cached package results). All ten approved-reference browser scenarios pass across the combined
run and focused reruns against the rebuilt application. Four real-data scenarios also pass:
responsive panel behavior, the populated closed-window review, template/live receipt/failure
previews, and two-agent locks/live replies. Initial combined runs hit time limits and short
initial-data waits on this machine; focused reruns pass with longer multi-width audit budgets
and explicit data-load waits, without removing assertions. The local production web image
builds successfully and reports healthy. The original application shell has no source changes.

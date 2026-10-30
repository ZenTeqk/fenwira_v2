# Centre-panel refinement — 30 October 2026

One countdown now sits beside the composer tabs. The neutral header strip describes automation
only; the former duplicate countdown and large closing-soon warning are removed. The compact
composer has an 80px input that grows to 180px, one toolbar and a small keyboard hint. Its
normal desktop height is approximately 196px. System events lose their outlined pills and gain
small relevant icons; document cards retain their data/download/receipts with tighter padding.

## Eligibility and behavior

The existing server eligibility query and expiry feed one centre-panel countdown timeout.
Muted (>60 minutes), amber (>15 through 60) and imminent badge (>0 through 15) thresholds are
presentation only. Unknown/error states never enable customer sends. Focus/visibility,
reconnection, conversation/inbound/eligibility changes and expiry recheck authoritative data.
Timers and subscriptions are cleaned up. Tooltips reuse the workspace metadata/timezone query
and AM/PM format, with the established India convention as metadata fallback. A controlled
browser fixture uses America/New_York to verify that browser/local defaults do not determine it.

Closed-window notices retain the template picker and permissions. Expiry rejection keeps the
draft, removes the optimistic row and rechecks eligibility. Contact/consent/number restrictions
retain their own explanations. Notes retain their separate draft, permissions and amber lock
treatment, without customer-window warnings. Existing uploads, locks, idempotency, Enter,
Shift+Enter, IME, delivery state, realtime and scrolling paths remain in use.

The automation strip reads explicit conversation policy states, preserving the existing action
endpoint and pending/error handling. The API has no flow-applicability or detailed pause-reason
field; no actual running flow is inferred from its active policy state. Unknown states are omitted.

## Rendered review and checks

Screenshots use isolated browser fixtures, not persisted product data. The running desktop and
phone UI was visually inspected, including the normal composer, imminent badge/helper, tighter
document card, single toolbar and responsive wrapping.

- [Normal desktop](centre-normal-1440.png)
- [Imminent expiry](centre-imminent-1440.png)
- [Internal note](centre-note-1440.png)
- [Phone](centre-responsive-375.png)
- [Other eligibility restriction](centre-restricted-1440.png)

Controlled-time unit cases cover exact 60/15 minute thresholds, last-positive time, expiry,
unknown/malformed values and timeout scheduling. Browser cases exercise threshold transitions,
polite expiry announcement, no 0m, focus/clock changes, preserved drafts, unknown eligibility,
note mode, rejected sends, blocked contacts, workspace timezone and repeated-resume protection.
Responsive checks include 1440/1024/768/375px, a 600px phone viewport and larger text, with Axe
checks on the normal, imminent, note and restricted states. Existing message-filter, document,
long-content and older-history scenarios are also checked.

Final validation: repository lint (including dependency boundaries and design-token checks),
type checking and all 591 unit tests pass, including cached package results. Eight production
browser scenarios pass: the three new centre-panel scenarios, 390px/500px keyboard layout,
real template/receipt/failure updates, two-agent locks/live replies, internal notes/resolution
and saved-reply editing/sending. The six focused development browser scenarios also pass,
alongside desktop/long-content and older-history checks. Initial controlled-clock test failures
were test timing/selector issues and were corrected; exact thresholds are covered by pure
controlled-time cases. A Google Fonts download failed during one image refresh; retry succeeded.
The final local web image is healthy. No backend, contract, dependency or shell changes.

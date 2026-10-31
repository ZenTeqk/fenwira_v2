# Light mode: shared shell, Home and Inbox (2026-10-31)

Approved direction: neutral surfaces, colorful feature accents, semantic statuses and emerald primary
actions; the Inbox is a neutral shell around a WhatsApp-inspired chat area. Colors come only from
the semantic tokens in `packages/ui/src/tokens.ts` (FENWIRA_DESIGN_SYSTEM.md §1, §8). No tokens
were added.

`before/` is `main` at `52672c2` (after the token refactor, PR #108). `after/` is this change.
Both sets come from `apps/web/e2e/light-mode-review.spec.ts`, which seeds records through the
domain APIs (`seedInbox`, `seedReviewInbox`) and runs axe and page-overflow checks:

```bash
LIGHT_SHOTS_DIR=$PWD/docs/design/experience-v2/evidence/light-mode-shell-home-inbox/after \
  pnpm --filter @fenwira/web exec playwright test e2e/light-mode-review.spec.ts
```

| File | Shows |
| --- | --- |
| `home-{1440,1024,768,375}.png` | Home (full page) |
| `inbox-1440-panel-open.png` / `-panel-closed.png` | List, thread and customer panel; panel closed with its header reopen control |
| `inbox-1440-note-mode.png` | Internal-note composer (amber) |
| `inbox-1440-list-states.png` | Selected, hovered and focused conversation rows |
| `inbox-{1024,768,375}.png` | Customer drawer below 1280, two-pane and single-pane layouts |
| `inbox-{1440,375}-failed-closed-window.png` | Long name, template with buttons, failed send with View details, closed reply window |
| `contacts-1440.png` | Shared-shell spot check on another module |

Screenshot data is generated review data, not product content.

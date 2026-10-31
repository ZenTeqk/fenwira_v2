# Light mode: Automations, flow builder, Reply Studio and AI Assistant (2026-10-31)

Extends the approved light theme (neutral surfaces, colorful feature accents, semantic statuses,
emerald primary actions; restrained violet for automation/AI) after #109 and #110. Colors come only
from the semantic tokens in `packages/ui/src/tokens.ts`; no tokens were added.

`before/` is `main` at `f37ea9c` (after #110). `after/` is this change. Both sets come from
`apps/web/e2e/light-mode-automation-review.spec.ts`, which creates records through the domain APIs:
published, paused and draft workflows built from the product's starter graphs, a real execution
from a customer message through the Meta mock, Reply Studio presets, and AI Assistant enabled with
the same local-database fixture as `ai-assistant.spec.ts` (the local AI provider is the mock):

```bash
AUTOMATION_SHOTS_DIR=$PWD/docs/design/experience-v2/evidence/light-mode-automations-ai/after \
  pnpm --filter @fenwira/web exec playwright test e2e/light-mode-automation-review.spec.ts
```

| Files | Shows |
| --- | --- |
| `workflows-{1440,1024,768,375}.png`, `workflows-starters-1440.png` | Workflow library, statuses, starters |
| `history-{1440,375}.png` | Execution history with a real run |
| `builder-1440.png`, `builder-1440-selected.png`, `builder-1440-readiness.png` | Canvas, selected node with settings, setup checklist |
| `builder-1440-selected-dark.png` (after only) | Dark tokens: nodes, handles, edges, controls |
| `builder-published-1440.png`, `builder-{1024,375}.png` | Published flow, narrow layouts |
| `reply-auto-replies-{1440,375}.png`, `reply-bot-flows-1440.png` | Reply Studio lists |
| `reply-wizard-1440.png`, `reply-business-hours-1440.png`, `reply-reports-1440.png` | Wizard, hours, reports |
| `reply-editor-{1440,375}.png` | Auto-reply editor with customer-phone preview |
| `ai-activation-1440.png` | Activation request page (AI not enabled) |
| `ai-{overview,knowledge,behaviour,activity}-1440.png` | AI Assistant tabs |
| `ai-test-{1440,375}.png` | Test question with an AI answer and sources |

Screenshot data is generated review data, not product content.

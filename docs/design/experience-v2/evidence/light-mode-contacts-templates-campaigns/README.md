# Light mode: Contacts, Templates and Campaigns (2026-10-31)

Extends the approved light theme (neutral surfaces, colorful feature accents, semantic statuses,
emerald primary actions) from the shell, Home and Inbox (#109) to Contacts, Templates and Campaigns.
Colors come only from the semantic tokens in `packages/ui/src/tokens.ts`; no tokens were added.

`before/` is `main` at `2c8433c` (after #109). `after/` is this change. Both sets come from
`apps/web/e2e/light-mode-modules-review.spec.ts`, which creates every record through the domain
APIs and the Meta mock (approved, pending, rejected and draft templates; tagged contacts including
a long name; draft, scheduled, running and paused campaigns) and runs axe and page-overflow checks:

```bash
MODULE_SHOTS_DIR=$PWD/docs/design/experience-v2/evidence/light-mode-contacts-templates-campaigns/after \
  pnpm --filter @fenwira/web exec playwright test e2e/light-mode-modules-review.spec.ts
```

| Files | Shows |
| --- | --- |
| `contacts-{1440,1024,768,375}.png`, `contacts-1440-selection.png` | Directory, selection with bulk actions, hover |
| `contact-detail-{1440,375}.png` | Detail with long name/email and empty fields |
| `contacts-create-dialog-validation-1440.png` | Create dialog validation |
| `contacts-imports-1440.png`, `contacts-import-{mapping,validation,result}-1440.png` | CSV import mapping, row problems and result |
| `contacts-{segments,tags}-1440.png` | Segments and tags |
| `templates-{1440,1024,768,375}.png`, `templates-preview-sheet-1440.png` | Library, status tabs, preview sheet |
| `template-detail-{approved,rejected,pending}-1440.png` | Detail per status, rejection reason |
| `template-editor-{1440,768}.png` | Editor with validation and live preview |
| `campaigns-{1440,1024,768,375}.png` | Operations list and history |
| `campaign-detail-{sent,scheduled}-1440.png`, `campaign-detail-sent-375.png` | Detail, delivery funnel, recipients |
| `campaign-wizard-{audience,template,personalize,schedule,review}-1440.png`, `campaign-wizard-review-375.png` | Creation steps |
| `campaign-launch-confirm-1440.png` | Launch confirmation (cancelled) |

Screenshot data is generated review data, not product content.

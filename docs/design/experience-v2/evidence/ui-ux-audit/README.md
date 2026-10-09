# UI/UX audit evidence (8 October 2026)

These captures come from [`apps/web/e2e/ui-ux-audit.spec.ts`](../../../../../apps/web/e2e/ui-ux-audit.spec.ts), run against the local Docker stack with the production web image and mock Meta.

- **Workspace:** one synthetic workspace, seeded once through the domain APIs and recorded in [fixture.json](fixture.json). It is a test account with no secrets.
- **Same data in both phases:** the before and after captures use the same records.
- **Fixture side effect:** each run saves another "Create campaign" draft, so the Drafts count grows between captures.

Findings: [UI_UX_AUDIT.md](../../UI_UX_AUDIT.md). Scores: [VISUAL_FIDELITY_REPORT.md](../../VISUAL_FIDELITY_REPORT.md).

## Capture sets

| Screen | Reference | Before (1440 × 1000) | After (1440 × 1000) |
| --- | --- | --- | --- |
| Home | [01](../../01-Home.png) | [before](before/01-home-1440.png) | [after](after/01-home-1440.png) |
| Inbox | [02](../../02-Inbox.png) | [before](before/02-inbox-1440.png) | [after](after/02-inbox-1440.png) |
| Contacts | [03](../../03-Contacts.png) | [before](before/03-contacts-1440.png) | [after](after/03-contacts-1440.png) |
| Templates | [04](../../04-Templates.png) | [before](before/04-templates-1440.png) (no template selected) | [after](after/04-templates-1440.png) (detail panel open) |
| Campaigns list | [06](../../06-Campaign-studio.png) | [before](before/05-campaigns-1440.png) | [after](after/05-campaigns-1440.png) |
| Create campaign | [05](../../05-Campaign.png) | [before](before/06-campaign-create-1440.png) | [after](after/06-campaign-create-1440.png) |
| Automations | [07](../../07-Automation-Studio.png) | [before](before/07-automation-studio-1440.png) | [after](after/07-automation-studio-1440.png) |
| Analytics | [08](../../08-Analytics.png) | [before](before/08-analytics-1440.png) | [after](after/08-analytics-1440.png) |
| Integrations | [09](../../09-Integrations.png) | [before](before/09-integrations-1440.png) | [after](after/09-integrations-1440.png) |

Each set also contains:

- `<screen>-1440-full.png`: the full page at 1440px.
- Full-page captures at 1280, 1024, 768 and 390px.
- `<screen>-checks.json`: page overflow, axe WCAG 2.2 AA violations and console errors at every width.

All checks are empty in both sets.

To reproduce, run from `apps/web` against a running stack:

```sh
UI_AUDIT_PHASE=after UI_AUDIT_ONLY=01,02,03 pnpm exec playwright test e2e/ui-ux-audit.spec.ts
```

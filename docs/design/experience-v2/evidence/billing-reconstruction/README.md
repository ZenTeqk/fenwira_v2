# Billing wallet — visual review checkpoint

8 October 2026. [Reference mapping and implementation](../../../EXPERIENCE_V2_BILLING_RECONSTRUCTION.md).

The page follows reference 10 with a compact balance summary, full ledger, current-plan context, effective entitlement features and configured manual-funding support. It preserves the existing ledger, wallet calculations, subscription domain, permissions and rollout flags. No backend/schema changes were made for this checkpoint. The missing Billing Usage page now reaches the existing customer-charge Usage view.

## Screenshots and evidence boundaries

- `actual-wallet-1440.png` and `actual-wallet-375.png`: actual persisted local textile demo. No financial history, plan or enforcement flag was changed to make these screenshots. Local billing is not enforced; that state is displayed honestly.
- `fixture/wallet-1440.png` and `fixture/wallet-375.png`: explicitly controlled browser response fixtures showing funded/reserved funds, promotional ledger identity and an active configured plan. These screenshots do not claim live funding or activation.
- `validation.json`: actual page checks at 1440, 1024, 768 and 375px; no page overflow or axe violations, 20px heading.
- `lighthouse.json`: authenticated actual Billing route, Lighthouse 12.8.2 accessibility score **100**.

Missing independent remaining paid/promotional balances, daily ledger series and commercial forecasts are not fabricated. Current plan names are data; effective capability display uses the entitlement response. Production prices remain unapproved and unset prices show Contact us. Provider costs do not appear.

## Concrete validation

- Web ESLint and typecheck: passed.
- Design lint: passed.
- Dependency boundaries: passed, 808 modules / 2782 dependencies checked.
- Web unit tests: all 24 passed.
- Production Docker frontend build: passed; rebuilt local frontend is healthy.
- Browser suite: **4 passed** in 1.4 minutes — responsive/financial-state/error-retry presentation, permission denial without financial requests, real MFA-operated manual funding/ledger/type filters/CSV export, and existing trial/limits/plan request regression.
- Presentation checks include NORMAL, LOW_BALANCE, INSUFFICIENT_FUNDS and NOT_ENFORCED, configured/unconfigured support, effective entitlement differences, unexpected provider-cost fields not rendered, four widths/axe and Usage routing.
- Actual local page responsive checks: all four passed, zero axe violations or horizontal overflow.
- Lighthouse accessibility: 100.
- `pnpm smoke`: API readiness, frontend rendering and API → outbox → relay → queue → worker round trip all passed.
- Prettier for changed Billing files and `git diff --check`: passed.

Existing repository-wide connector/financial/RLS regression results remain in the prior connector checkpoint; they were not rerun or relabelled as a new Billing backend run. The user's pre-existing changes remain preserved. Temporary capture profiles and raw Lighthouse output were removed; only curated evidence is retained.

Stop here for Billing visual review before Settings. No Phase 11 closure action or declaration is part of this checkpoint.

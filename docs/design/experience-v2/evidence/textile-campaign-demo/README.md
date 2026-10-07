# Textile campaign local demo

Ten campaigns in a separate synthetic workspace, with product-specific approved mock templates and uploaded textile artwork. [All-status snapshot](textile-campaigns-all-statuses.png) and [sanitized account/campaign manifest](textile-demo.json).

| Campaign | Initialized status |
| --- | --- |
| Organic Cotton Collection | Draft |
| Pongal Silk Saree Festival | Scheduled |
| Summer Linen Collection | Preparing |
| Festive Cotton Saree Offers | Running |
| Kids Ethnic Wear Launch | Paused |
| Bridal Kanjivaram Collection | Paused: insufficient funds |
| Designer Kurti New Arrivals | Paused: template unavailable |
| Handloom Bedsheet Collection | Completed |
| Denim Weekend Collection | Cancelled |
| Winter Shawl Collection | Failed |

Demo login: **textile-demo-muyfp4colkx8@fenwira.test**. Use this account at http://localhost:3000/login with the existing public local E2E password `correct-horse-battery-fenwira`. The workspace is **Fenwira Textiles — Local Demo**. All shoppers and contact details are synthetic; WhatsApp is localhost Meta simulation only.

Draft/scheduled/running/manual pause/completion/cancellation use existing tenant APIs and domain services. Four rare states (Preparing, insufficient funds, unavailable template and Failed) are explicitly initialized as local lifecycle fixtures through `Database.withTenant`, guarded by the local mock configuration, exact demo workspace, known campaign IDs/names and DRAFT precondition. Every rare transition appends a `demo.campaign.state_seeded` audit record. The two rare pause fixtures contain eight actual synthetic PENDING recipient rows; their metrics come from existing stats. No financial history, wallet funds, billing mode or enforcement setting is modified. Failed is labelled as simulated audience preparation failure before sending.

**Preparing and Running are transient.** Normal recovery/dispatch workers continue to advance them. The all-status manifest and screenshot record their capture-time states; later visits can show Running/Completed instead. No workers or production safeguards are disabled to pin a demo status. Six active cards can be expanded using Show more campaigns; four historical campaigns appear below. Scheduled is one week in the future.

Recreate only when explicitly wanted: `CREATE_TEXTILE_DEMOS=true pnpm --filter @fenwira/web exec playwright test textile-campaign-demo.spec.ts`. The spec is skipped without this flag. It creates a fresh isolated demo account/workspace, verifies exactly ten records and equality with all ten supported campaign statuses, then captures the fully loaded page. No demo branch or hardcoded campaign data is added to application rendering.


Validation: explicit creation spec **1 passed (1.3m)**; exactly ten persisted API campaigns with all ten supported statuses at the manifest timestamp. Six expanded active cards and loaded sample images captured at 1440 × 1000, followed by four history records. Web lint/typecheck and targeted formatting passed. Initial capture attempts exposed a missing list-loading wait and an incorrect seven-card expectation; both fixture assertions were corrected without changing application/domain behavior. Earlier attempts used separate synthetic accounts; the manifest identifies the final review workspace.

No application code, backend routes, schema, workers or production configuration changes. No production build needed for this opt-in demo fixture/documentation change. The initial temporary browser outputs are removed after retaining intended final evidence.

A final tenant-scoped read verified **10 campaigns and 4 demo transition audit records**. The completed all-status screenshot was visually inspected. Financial tables were not part of fixture initialization.

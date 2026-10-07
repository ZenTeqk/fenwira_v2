# Campaigns and Campaign Studio — reference decomposition

Templates, including its recipient mobile preview, is now visually approved by the user. This checkpoint covers Campaign operations and Create Campaign together, with separate visual validation, then stops before Automations.

## Reference and existing product

| Area | Existing implementation | Reference-led correction |
| --- | --- | --- |
| Shell/header | Older shell scale; generic campaign subtitle | Approved 224px navigation/56px header, clear Campaigns/Create campaign purpose |
| Operations | Spacious active cards and a combined results cell | Compact operational identity, real schedule band/progress/results, clear history surface |
| Navigation | Supported status views and search | Compact view counts, filters using loaded status/date/audience, explicit sorting |
| Studio | Five supported saved steps, two columns, actions inside left column | Connected step navigation, contextual campaign/template identity, compact work surface, bottom action bar |
| Preview | Editor-style variable chips | Approved recipient-facing mobile preview, existing server-estimated recipient selection |
| Summary | Vertical configuration metadata | Real audience/charge/wallet summary with quiet supporting configuration |

## Intentional product differences

Campaigns have no persisted campaign artwork or descriptive subtitle, and campaign stats do not include attributed replies. Use semantic communication icons, actual frozen template/audience source and existing sent/delivered/read rates; never invent thumbnails, reply counts or percentages. Campaign snapshots do not contain friendly audience names: do not infer them from IDs. Draft/scheduled audience counts are not final; recipients are frozen at launch. Active/scheduled/paused and exceptional pause states remain distinct, with unchanged recovery copy.

All existing campaign APIs, approved-version authority, eligibility/consent, variable sources, fallback behavior, one-time schedule, workspace timezone, pacing, save-on-continue, unsaved-navigation protection, launch idempotency/confirmation and wallet reservation semantics remain authoritative. Counts/filters/sorting describe the loaded campaign collection; no backend search/pagination capability is invented. Subscription enforcement and provider-cost confidentiality remain unchanged.

The Studio uses actual stored template examples until an estimate matches the saved audience/template/mapping, then actual server sample recipients. No unsaved local eligibility or variable-resolution engine. Missing customer charge/wallet amounts remain unavailable. Existing Save and continue wording explains the persistence step.

## Validation

Capture before, first pass and final at 1440 × 1000. Validate operations and Studio separately at 1024/768/375, Axe/overflow/keyboard permissions, failures/empty states, real immediate and scheduled launches, stale preview handling, idempotent retry and unsaved draft protection. Extend existing tests without weakening lifecycle assertions. Keep sanitized screenshots/results under `experience-v2/evidence/campaigns-reconstruction/`; preserve earlier evidence. No backend/domain changes expected.

## Implemented correction and review

Active cards now put progress above compact results; history has explicit sent/delivered/read columns. Views carry actual loaded counts, with supported status/date/audience filters and sorting. Campaign analytics remains available as a quiet header link. Create Campaign uses connected steps, contextual identity, one coherent left surface and a recipient mobile preview beside actual audience/charge/wallet information. Existing actions remain in their disabled-busy fieldset in the new footer.

First-pass captures showed excessive Studio height from decorative wallpaper, repeated metadata and separated cards. The final pass joins configuration sections, reduces their interiors to 12px, places save status beside desktop steps and opts Studio into a shorter wallpaper area. Full message content and the approved Templates default remain unchanged. All final operations/Personalize/Review captures were visually inspected at 1440/1024/768/375.

Before captures retain the existing 1440 × 900 baseline; final captures use a 1440 × 1000 viewport and full-page output where content grows. See [concrete validation and review artifacts](experience-v2/evidence/campaigns-reconstruction/README.md). Ready for visual review; stop before Automations.

## Populated operations fidelity correction

The user rejected the operations page's visual fidelity against `06-Campaign-studio.png` and requested ten additional demo campaigns. This correction is restricted to Campaigns operations; Create Campaign and all earlier approved screens remain unchanged. Campaign artwork now reuses the actual frozen template IMAGE header sample through the existing permission-gated, tenant-scoped signed URL service. Missing samples retain semantic icons. Campaign descriptions come from the actual frozen template body, not a new commercial field. Friendly audience names come from existing authorized tag/segment catalogs with the established source fallback if unavailable.

Cards show image, inline status, content summary, actual audience, progress above Delivered/Read/Started, schedule band and supported View campaign actions. History uses thumbnails and Campaign/Audience/Status/Sent/Delivered/Read/Date/actions, with five-row local pagination over loaded records. Running campaigns precede scheduled communications; all paused recovery surfaces and additional active records remain accessible. No nonfunctional checkboxes or unsupported attributed replies are added.

A dedicated localhost-only browser fixture creates two featured campaigns plus ten additional persisted campaigns, with original uploaded demo artwork, synthetic consenting contacts and simulated Meta. The populated page and both history pages require separate visual review; this is not an exact-match or approval claim. See [final fidelity evidence](experience-v2/evidence/campaigns-final-fidelity/README.md).

## API-driven reconstruction follow-up

The subsequent Campaigns-only request keeps `06-Campaign-studio.png` as the visual specification, while requiring the layout to adapt to customer-created records. Repository assessment confirms `/campaigns` returns up to 200 tenant-scoped records, with client collection filters and local five-row history pagination. The stats DTO supports sent/delivered/read and nullable rates, but no attributed replies. Artwork is the authorized frozen template image sample; audience labels use the existing catalogs. All campaign mutations, Studio routing and permission checks remain unchanged.

Presentation is now separated into CampaignCard, CampaignHistory, CampaignArtwork/CampaignActions and CampaignFilter components, with pure collection selection in `campaign-presentation.ts`. The page orchestrates the existing queries and filters. Cards consolidate category, audience and recipient context into a wrapping metadata line; scheduled footer navigation explicitly says View schedule and uses the existing detail route. Missing frozen messages remain explicitly unavailable. History remains compact, with actual fields and supported row navigation.

The shared StatusBadge has a narrowly scoped campaign context: RUNNING uses existing success tokens and retains its actual status/label; its default informational appearance is unchanged in other modules. Scheduled/paused/failed retain their meanings. No palette, shell or approved screen redesign. Loading errors use friendly fixed copy without raw API diagnostic text; filtered-empty copy is “No campaigns match these filters.”

No backend, contracts, worker, billing, subscriptions or tenant authorization changes. Tests distinguish real persisted campaign review data from a controlled 200-record browser response used only to stress long names, audience wrapping, pagination and missing snapshots. Loaded-collection filters are not represented as global server search. See [current review evidence](experience-v2/evidence/campaigns-data-driven/README.md). Stop at Campaigns visual review.

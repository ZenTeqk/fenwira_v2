# Verification: outstanding light-theme e2e failures (2026-10-31)

Branch `light-mode-automations-ai`. Each folder holds Playwright `error-context.md` (error, page
snapshot) and `trace.zip` (screenshots, DOM, network; open with `npx playwright show-trace`).

| Folder | What ran |
| --- | --- |
| `branch/` | The 4 original tests on this branch's build (all failed) |
| `base-f37ea9c/` | The same original tests in an isolated git worktree at `f37ea9c` (main after #110, this branch's base), same lockfile, port, env, API and database |
| `base-0a80b04/` | The same, at `0a80b04` (main before #108, i.e. before any light-theme work) |
| `failure-details/` | `automation-failure-details.spec.ts`: mocked execution failures, light and dark |
| `reply-editor-ai/` | `light-mode-automation-review.spec.ts` with dark captures (`*-dark.png`) of the reply editor and AI screens |

## Results

| Test | Error | Root cause | Origin | Resolution |
| --- | --- | --- | --- | --- |
| `design-system.spec.ts:94` contacts quick view drawer | `getByRole('dialog', {name: 'Farah Ali'})…region 'Messaging eligibility'`: not found | At the default 1280px viewport Quick view opens the inline context panel (intended since the Contacts reconstruction); the drawer is used below 1280px. Full eligibility is inside the "Eligibility and consent details" disclosure, and "Open full profile" moved into the More menu | Fails identically at `f37ea9c` and `0a80b04` | Test runs at 1024px (drawer is the intended UI), expands the disclosure, opens the profile via More. All assertions kept |
| `keyboard.spec.ts:77` command palette nav | `getByRole('navigation', {name: 'Breadcrumb'})` not found on "All contacts" | The approved shell has no top-bar breadcrumb on list pages; location is the current module tab / navigation link (`aria-current="page"`). Module "Overview" pages are the module root (Integrations has no tabs by design) | Same at both base commits | Asserts a breadcrumb or current-page link naming the leaf (module name for an Overview leaf) |
| `live-preview.spec.ts:55`, `:76` | `getByLabel('Message', {exact: true})` strict mode: 3 elements | Ambiguous locator: the step-library button (`aria-label="Message"`), the inspector section and the textarea share the name | Same at both base commits | `getByRole('tabpanel', {name: 'Node settings'}).getByRole('textbox', {name: 'Message'})` |

The updated tests also pass against the `f37ea9c` build, so they don't depend on this branch.

## Application defect found and fixed

Execution history "Show on canvas" never showed step outcomes: the history page lowercased step
statuses (`failed`) while the canvas matches the contract's `STEP_STATUSES` (`FAILED`), so the
failed step looked like a successful one (green outline, ready check). Present since Phase 10
(`3018856`). Fixed in `app/(app)/automations/[id]/history/page.tsx`; a failed replayed step now
has a `status-error` outline beside its labelled "Failed" badge (`flow-canvas.tsx`).
`automation-failure-details.spec.ts` asserts the badges; it failed on the unfixed build and passes
on the fix.

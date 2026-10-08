# Automations — Experience V2 reconstruction

## Authority and reference decomposition

Campaigns received visual approval on 8 October 2026; the user authorized the next checkpoint. Scope is Automations, using `07-Automation-Studio.png` and the approved shell/Home/Inbox/Contacts language. Stop for visual review before Analytics.

The concept uses a compact header, a joined white studio surface, narrow searchable step library, warm dotted central canvas, white icon-led nodes with clear branch connectors, compact zoom/minimap controls and a contextual selected-step panel. The implementation reuses BuilderPage, React Flow, Outline, schema-driven NodeInspector, existing validation and tenant-scoped queries. Desktop prioritizes the canvas; smaller screens open settings in a modal and phones use the keyboard-friendly Outline.

## Actual product boundaries

- Only the existing 18 node types are offered. One trigger per flow remains enforced; after one is present, edit it rather than offer duplicate triggers.
- Delay is a fixed durable wait. The concept's “Customer replied?” and wait-for-reply remain excluded (AE1).
- No simulation/Test capability or run-today/completion/attention aggregate exists in the Flow DTO. Header shows actual total/running counts, live version and save state. No fabricated percentages.
- Published versions remain immutable and executions stay pinned. Save flushes the existing autosave adapter; Publish confirms its impact before calling the existing domain endpoint.
- Message previews preserve expression markers. Template previews show the selected approved template, with authorized sample URLs; the engine still resolves the approved version at runtime.
- No new nodes, expressions, APIs, schema, workers, commercial rules or execution behavior.

## Presentation changes

White nodes retain category identity in semantic icon surfaces; emerald selection, labelled branches, restrained smooth connectors and arrowheads replace heavy colored node surfaces. Library search is local presentation over the existing catalog. Shared BuilderPage adds an optional joined studio appearance; its default layout remains unchanged. Automations adopts the existing approved compact shell variant. Settings keep every existing schema-driven form and permission check. Loading failures now show an explicit retry state rather than an indefinite skeleton; save failures retain local changes and offer retry. Browser node dimensions are retained locally for the minimap, and settings dismissal explicitly restores focus. Neither changes the persisted graph.

## Validation and evidence

See [Automations review evidence](experience-v2/evidence/automations-reconstruction/README.md). Ready for visual review when the recorded checks complete; no Analytics work is included.

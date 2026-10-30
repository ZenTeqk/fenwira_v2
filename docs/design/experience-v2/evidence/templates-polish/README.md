# Templates library polish — 30 October 2026

The Templates page now uses the existing warm canvas, a separate compact white filter toolbar
and responsive individual cards. The 3/2/1-column grid has 16–20px gaps. White cards use a thin
scoped border, 12px corners, 16px padding, subtle hover elevation and visible keyboard focus.
Readable titles are derived only for display; exact technical identifiers and detail-route IDs
are preserved. Category and language pills sit below titles, with approval status at the upper
right. Footers align timestamps and compact eye/Preview buttons.

The requested semantic category/status colours are defined in `packages/ui` with contrast tests.
Zero counts remain neutral; active tabs remain emerald, Create stays primary and Sync secondary.
The requested Preview hover background is retained, with the existing darker emerald foreground:
the requested normal foreground on that hover background measures 4.48:1, below small-text AA.
The application is light-only (DS1); no unrelated colour treatments or dark-mode infrastructure
were added.

Card previews use 192px sage stages, 12px-radius white bubbles, readable 13px text, compact media
placeholders and existing mint sample-variable chips. Headers, footers and buttons remain real
stored content. A bottom fade and crop replace nested scrolling; the existing Preview sheet
retains complete content and keyboard focus return. Signed sample media and retry handling use
their original hooks, with errors/retry controls outside the cropped stage. Full recipient/editor
renderers preserve their defaults through an opt-in library presentation.

## Visual review

These captures use isolated browser fixtures, including an illustrative local image asset. No
sample messages or media were added to production data. Desktop and mobile captures were
visually inspected.

- [1440px / three columns](templates-polished-1440.png)
- [1024px / two columns](templates-polished-1024.png)
- [768px / two columns](templates-polished-768.png)
- [375px / one column](templates-polished-375.png)

## Checks

Focused browser checks pass for exact identifiers, readable titles, signed image rendering,
document/video placeholders, authentication messages, variable samples, long content in full
Preview, unchanged detail links, filter query parameters, sync, creation link, zero counts and
keyboard focus restoration. All four widths have 192px stages, the expected column count and
no horizontal page overflow or nested card scrollbars. Axe WCAG A/AA checks pass. The semantic
colour contract and design-token checks pass.

Final repository lint (including dependency boundaries), typecheck and all 597 unit tests pass.
Seven final production-browser scenarios pass: the polished-library fixture, real filtering/sync
and keyboard context at four widths, draft/error recovery, read-only access, sending-option
recovery, creation through approval and inbox sending, and the Lighthouse gate. Lighthouse
accessibility scored 100/100 with no failing audits; see [scores](lighthouse-accessibility.json).
The rebuilt local web app is healthy. The new palette leaves unrelated modules unchanged.

No backend, API, template data, permission or dependency changes.

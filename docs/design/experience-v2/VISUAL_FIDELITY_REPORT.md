# Experience V2 — visual fidelity and UX scores

8 October 2026. Reviewer assessments, not measurements. Visual fidelity weights: layout 25, colour/surfaces 20, typography 15, component structure 15, icons/details 10, spacing/density 10, states 5. UX weights: usability 25, hierarchy 20, consistency 20, accessibility 15, responsive 10, feedback 10. Findings are in [UI_UX_AUDIT.md](UI_UX_AUDIT.md); captures in [evidence/ui-ux-audit/](evidence/ui-ux-audit/README.md).

| Screen | Initial visual | Final visual | Initial UX | Final UX | Status |
| --- | ---: | ---: | ---: | ---: | --- |
| Home | 84 | 86 | 84 | 88 | Improved; short-list whitespace remains |
| Inbox | 86 | 87 | 88 | 89 | Improved (phone) |
| Contacts | 86 | 89 | 85 | 90 | Improved (clipping, phone) |
| Templates | 85 | 86 | 86 | 88 | Improved (panel action) |
| Campaigns List | 86 | 88 | 84 | 89 | Improved (action affordance, preview) |
| Create Campaign | 89 | 89 | 90 | 90 | Already aligned; unchanged |
| Automations | 62 | 85 | 60 | 86 | Major fix (stacked canvas) |
| Analytics | 82 | 85 | 80 | 86 | Improved (axis, series order) |
| Integrations | 87 | 89 | 88 | 89 | Improved (hierarchy) |

## Why scores stop short of the 95 visual target

Most remaining distance is not frontend styling:

- **Illustrative reference data (R1):** photographs, counts, product cards, typing and voice notes.
- **Backend capabilities (B1):** campaign replies, template usage counts, per-flow run metrics and the API-generated template preview text; see [BACKEND_UI_DEPENDENCIES.md](BACKEND_UI_DEPENDENCIES.md).
- **User-approved differences (D1):**
  - 20px module titles and denser modules (8 Oct);
  - the Inbox views menu;
  - accessible muted text;
  - masked phone numbers in the thread header;
  - WhatsApp template names as card titles.

The remaining frontend items are Low: Home's short-list whitespace, Analytics row whitespace, Contacts panel message link, Templates panel spacing and the technical variable label.

## Evidence basis

The automated checks were clean both before and after. They covered all nine screens at five widths, checking overflow, axe WCAG 2.2 AA and console errors. The existing e2e regression for the touched screens ran 57 tests: all passed, and 2 opt-in tests were skipped.

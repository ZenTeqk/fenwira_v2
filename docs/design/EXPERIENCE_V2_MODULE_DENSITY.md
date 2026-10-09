# Experience V2 — module density refinement

8 October 2026. The user requested smaller Templates, Campaigns, Automations, Analytics and Integrations while preserving the approved workspace direction.

These modules use 20px page headings, 13px descriptions and 16px vertical shell padding. Campaign cards have smaller artwork and headings; Templates uses a 288px context pane. Analytics summary values use 20px text and 32px icon surfaces, with a 160px overview graph. The shared chart measures its container width so widening a card does not enlarge chart labels. Automation's desktop canvas is 480px/544px rather than 640px/704px; the outline and node inspectors remain available.

Long data can scroll. No CSS zoom/scale or reduced body-text/touch-target contract is used. Home's approved padding is preserved. Integration summary sizing and the native application grid ship with the connector follow-up.

Validation: repository lint, typecheck and all 320 unit tests passed. Analytics browser checks measure the actual chart height at four widths, preserving its accessible table alternative. Browser reconstruction checks and the final local textile workspace viewport/Lighthouse evidence are recorded in [the combined review checkpoint](experience-v2/evidence/native-connectors-density/README.md).

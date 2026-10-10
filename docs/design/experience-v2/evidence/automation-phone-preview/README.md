# Automation right-panel phone preview — 8 October 2026

Selected Send message and Send template steps reuse the approved WhatsApp mobile preview from Templates and Campaigns. The preview displays the configured message, template buttons and authorized image header samples where available. Expression markers remain visible until runtime. The business header uses the shared generic placeholder.

## Visual evidence

- [Desktop, 1440px](text-message-1440.png): phone preview inside the right settings panel.
- [Mobile, 375px](text-message-375.png): phone preview inside the settings modal.
- [Recorded accessibility and overflow checks](validation.json): zero WCAG A/AA axe violations and no document horizontal overflow at both widths.

Captures use the existing unpublished Textile enquiry follow-up draft in the synthetic local demo workspace. No stored draft was changed and no message was sent. An image-header capture was unavailable because this workspace has no approved image template; this follow-up does not claim a browser verification of image headers. Their existing signed sample URL path is retained.

## Validation

- Web typecheck and lint: passed.
- Design token lint and diff whitespace checks: passed.
- Production Docker frontend build/restart: passed, healthy.
- Automation browser suite: **4 passed** (29.9s), covering responsive settings at 1440/1024/768/375, phone preview, accessibility, focus restoration, draft error retry, read-only permissions and server publish denial, create/publish/simulated execution/history/replay, and keyboard Outline editing.
- Local smoke: passed API readiness, frontend/sign-in and outbox → relay → queue → worker.

The change adds no backend APIs, domain behavior, schema, dependencies or billing configuration. Long previews scroll inside the existing panel or modal. Ready for visual review; Analytics has not been started.

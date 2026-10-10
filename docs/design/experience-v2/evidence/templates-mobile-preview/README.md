# Templates — recipient mobile preview

Requested refinement: preview the template as a customer would see it in a WhatsApp mobile conversation.

The library details, template record and live editor share a responsive phone frame with decorative status bar, selected account identity, original low-contrast chat texture, incoming message bubble, timestamp and composer. Stored content/sample variables are rendered as plain text with basic bold/italic/strikethrough/monospace formatting. Buttons are attached to the bubble and intentionally non-interactive. Existing signed sample URLs are reused for images/video; unavailable media and document samples are labelled rather than fabricated. Missing variables retain placeholders.

This is a recipient-facing simulation, not the actual WhatsApp application. Phone chrome and time are illustrative, and device-specific layout, nested formatting or document previews may differ. Review actual approved delivery through the existing Inbox workflow when needed; no new sending shortcut or automatic test message was introduced.

Validation:

- Web lint/typecheck/design-token check: passed.
- Web unit tests: 15 passed.
- Dependency boundary check: passed, 754 modules / 2614 dependencies.
- Templates browser suite: 6 passed (1.4m), including four responsive widths, permissions, failed-submission draft preservation, approved-option retry and full create/submit/approval/Inbox-send flow.
- Live editor checks additionally cover plain variable substitution, bold/italic/strikethrough and HTML-like sample values remaining escaped text.
- Production web build: passed; local web service healthy.
- Four-width Axe checks: zero violations, no horizontal page overflow.
- Final rounded-frame responsive/read-only/Lighthouse rerun: 3 passed (33.4s); Lighthouse accessibility 100, zero failed audits.
- Repository formatting and diff checks: passed.

Final captures: [1440px](template-context-1440.png), [1024px](template-context-1024.png), [768px](template-context-768.png), [375px](template-context-375.png).

No backend, contracts, schema, subscription or billing changes. Home, Inbox and Contacts are unchanged. Campaigns remains a later visual checkpoint.

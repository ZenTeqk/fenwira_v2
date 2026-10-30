# Inbox compact typography

Conversation and customer panels use 13px body text, 12px supporting text, 14px compact
headings and 16px panel titles. Messages keep a 1.5 line height. The conversation list and
application navigation retain their existing typography.

Screenshots were captured with isolated browser fixtures at desktop, tablet and phone sizes.
The desktop, long-content and compact-icon browser scenarios passed, including real actions,
IME composition, responsive details and accessibility checks. The 1440px conversation, 375px
conversation and 375px customer drawer screenshots were visually reviewed for spacing,
wrapping and readability.

Final PR validation: repository lint (including module boundaries and design tokens), type
checking and all 566 unit tests pass, including cached package results. The rebuilt local
production web service is healthy, and its desktop/actions/accessibility and history-anchor
browser checks pass.
All seven approved-reference browser scenarios also pass against the rebuilt application.

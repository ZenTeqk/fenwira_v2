# Phase 8 — Template Management

**Goal:** create → validate → submit → track approval → use an approved template anywhere (inbox, campaigns, automation).

**Read:** `AGENTS.md`, `docs/TEMPLATE_ENGINE.md`, `docs/META_INTEGRATION.md`, `docs/DESIGN_SYSTEM.md` (variable chips).

## Build

1. **Entities:** `Template` (name, category ∈ MARKETING/UTILITY/AUTHENTICATION, language, WABA, current status) and `TemplateVersion` (an immutable components JSON: header text/image/video/document, body, footer, buttons (quick reply / URL / phone / copy code), variable samples, Meta template ID, status, rejection reason, submitted_at, decided_at). Editing an approved template creates a new version, and the old version stays usable until the new one is approved.
2. **Validation** (shared Zod in `packages/contracts`, used by both UI and API): Meta's naming rules, length limits per component, sequential variables `{{1}}…{{n}}` with no gaps, a sample value for every variable, button count/type rules, and media type/size limits. Marketing-category heuristics produce a warning, not a block.
3. **Submission:** header media is uploaded to Meta (resumable upload), then the template is created through the Graph API. A transport or network failure is **not** a rejection; the version stays DRAFT with a retryable error. Template status webhooks (from Phase 5 normalization) update the status, and a periodic sync job reconciles as a fallback. A "Sync from Meta" action imports templates created outside Fenwira.
4. **UI:**
   - Templates list: filters by status/category/language, StatusBadge, last updated.
   - Two-pane builder: the editor (category, language, header, body with a variable inserter, footer, buttons, sample data) and a live WhatsApp-style preview. Variables render as `primary-soft` chips with `primary` text.
   - Version history tab, with a submit button gated by validation.
5. **Usage API:** `listApproved({language?})` and `render(templateVersionId, variables)`. `MessagingService` accepts `{templateVersionId, variables}` and builds the Meta components payload.
6. **Permissions:** `templates.write`, `templates.submit`.

## Acceptance criteria

- [ ] A template round-trips on a real WABA: submit → approval webhook → APPROVED → sent from the inbox template picker.
- [ ] A rejected template shows Meta's reason. Editing it creates version 2 while version 1 stays unchanged.
- [ ] Invalid templates (variable gap, missing sample, too many buttons) are blocked identically by UI and API (shared schema test).
- [ ] A network failure on submit leaves the version DRAFT and retryable, never REJECTED.

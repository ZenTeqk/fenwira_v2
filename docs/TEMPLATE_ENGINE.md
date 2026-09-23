# Template Engine

## Scope

WhatsApp message templates: the component model, validation, submission to Meta, the approval lifecycle, versioning, sync, and how other modules render and send templates.

## Decisions

### Model

- A `Template` is identified by `(waba, name, language)`, matching Meta's identity. A `TemplateVersion` holds the content.
- **Versions are immutable once submitted.** Editing an APPROVED or REJECTED template creates version N+1 as a DRAFT. The template's `approved_version_id` keeps pointing at the last approved version, which stays usable until the new one is approved.
- Meta allows editing an approved template in place (with limits), and that edit replaces what Meta serves. So when version N+1 is submitted for an existing Meta template ID, it is sent as an **edit** of that ID. While it is under review, Meta keeps serving the previous content. Once approved, `approved_version_id` advances.

### Components (`packages/contracts/src/templates/components.ts`)

```ts
type TemplateComponents = {
  header?: { format: 'TEXT'; text: string }                          // ≤ 60 chars, ≤ 1 variable
         | { format: 'IMAGE' | 'VIDEO' | 'DOCUMENT'; sampleFileId: string }
  body: { text: string }                                              // ≤ 1024 chars
  footer?: { text: string }                                           // ≤ 60 chars, no variables
  buttons?: Array<
    | { type: 'QUICK_REPLY'; text: string }                           // ≤ 25 chars
    | { type: 'URL'; text: string; url: string }                      // url may end with one {{1}}
    | { type: 'PHONE_NUMBER'; text: string; phoneE164: string }
    | { type: 'COPY_CODE'; example: string }
  >
}
type VariableSamples = { header?: string[]; body: string[]; buttons?: Record<number, string[]> }
```

AUTHENTICATION templates use Meta's fixed OTP format (body preset, COPY_CODE or ONE_TAP button). The builder shows a restricted form for them.

### Validation (shared Zod, run by both UI and API)

| Rule | Error code |
| --- | --- |
| Name `^[a-z0-9_]{1,512}$`, unique per WABA and language | `TEMPLATE_NAME_INVALID`, `TEMPLATE_NAME_TAKEN` |
| Positional variables `{{1}}…{{n}}`, sequential with no gaps, starting at 1 per component | `TEMPLATE_VARIABLES_NOT_SEQUENTIAL` |
| Variables can't be adjacent (`{{1}}{{2}}`), and the body can't start or end with a variable | `TEMPLATE_VARIABLE_PLACEMENT` |
| Variable-to-text ratio: at least 3 words per variable in the body (Meta heuristic) | `TEMPLATE_TOO_MANY_VARIABLES` (warning) |
| A sample for every variable | `TEMPLATE_SAMPLE_MISSING` |
| Length limits per component (above) | `TEMPLATE_TOO_LONG` |
| Buttons: at most 10 total; QUICK_REPLY and CTA types grouped (not interleaved); at most 2 URL; at most 1 PHONE_NUMBER; at most 1 COPY_CODE | `TEMPLATE_BUTTONS_INVALID` |
| Header media: IMAGE jpeg/png ≤ 5 MB; VIDEO mp4 ≤ 16 MB; DOCUMENT pdf ≤ 100 MB | `TEMPLATE_MEDIA_INVALID` |
| Marketing heuristics on UTILITY (for example "offer", "discount", "% off", "sale") | `TEMPLATE_CATEGORY_MISMATCH` (**warning**, not a block) |

Warnings are returned in `warnings[]` and never block submission.

### Lifecycle

```text
DRAFT ──submit──► PENDING ──Meta APPROVED──► APPROVED ──Meta PAUSED──► PAUSED ──(Meta un-pauses)──► APPROVED
  ▲                  │                          │
  │                  └──Meta REJECTED──► REJECTED
  │                                             └──Meta DISABLED──► DISABLED
  └── transport/5xx error on submit: stays DRAFT, last_error set, retryable
```

- `ARCHIVED` is Fenwira-only: the template is hidden from pickers. Deleting also deletes it at Meta (`DELETE …?name=`, which removes every language). The UI confirms that consequence.
- A **submit transport failure is never REJECTED.** Only a Meta review decision or a Meta 4xx validation error (with its message stored in `rejection_reason`) produces REJECTED.
- Status updates arrive from the `message_template_status_update` webhook (routed by `whatsapp.status` → `TemplatesService.applyStatusEvent`). The `whatsapp.sync` job reconciles every template of every connected WABA every 6 hours, as a fallback.
- `template_category_update` (Meta re-categorized the template): update the category, record an activity, and notify.
- Each transition emits `template.status.changed`, which sends an in-app notification to the creator and to admins.

### Submission

1. Validate. Any error returns 422 with the codes.
2. For media headers: the resumable upload of `sampleFileId` to Meta produces a `header_handle`.
3. Build the Meta payload: components with `example` blocks from the samples.
4. `POST /{waba_id}/message_templates` (new) or `POST /{meta_template_id}` (edit).
5. Store `meta_template_id`, set status PENDING and `submitted_at`, and write the audit entry.

### Sync from Meta

`POST /templates/sync` paginates `GET /{waba_id}/message_templates`. Unknown templates are imported as a Template plus version 1 with Meta's status. Existing ones get their status and quality updated. Content diffs create a new version, marked as Meta-originated.

### Rendering and sending

`TemplatesService.buildSendPayload(templateVersionId, variables)` returns the Meta `template` message object (`name`, `language.code`, `components` with parameters). The rules:

- `variables` is `{ header?: string[]; body: string[]; buttons?: Record<index, string[]> }`, positional.
- Every variable is required. An empty string is rejected with `TEMPLATE_VARIABLES_INVALID`.
- Media headers at send time take `{ header: { fileId } }` or fall back to the sample.

Campaigns resolve variables from mapping expressions (`CAMPAIGN_ENGINE.md`) before calling `MessagingService`. The inbox fills them in a form. Automation uses node config with `{{contact.*}}` expressions.

### Builder UX

Two panes: the editor (category, language, name, header, body with a "+ Variable" inserter, footer, buttons, samples) and a live WhatsApp-style preview (phone frame, bubble, buttons). Variables render as `primary-soft` chips with `primary` text in both the editor and the preview (the preview shows the sample value on hover). The Version history tab lists versions with status, submitted and decided times, and the rejection reason.

## Open questions

| # | Question | Owner |
| --- | --- | --- |
| TE1 | Do we need multi-language template groups (one logical template, many languages) in the UI? Assumed each language is a separate template in v2. | Product |
| TE2 | Carousel and limited-time-offer templates: assumed out of scope for v2. | Product |

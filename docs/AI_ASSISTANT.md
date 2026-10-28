# AI Assistant

## Scope

The AI Assistant replies to WhatsApp customers using only the knowledge a workspace uploads: documents, FAQs and pasted text. English only. It runs as an automation step (`action.ai_reply`) and as a one-click managed flow. Decisions are in [ADR-0028](adr/0028-ai-assistant-bedrock.md).

## Configuration (env, `packages/config` → `aiEnv`)

| Variable | Default | Meaning |
| --- | --- | --- |
| `AI_PROVIDER` | `mock` | `bedrock` in production; `mock` is deterministic (tests, local) |
| `AI_BEDROCK_REGION` | `ap-south-1` | Bedrock Runtime region |
| `AI_TEXT_MODEL_ID` | `apac.amazon.nova-lite-v1:0` | Converse model or inference profile |
| `AI_EMBEDDING_MODEL_ID` | `amazon.titan-embed-text-v2:0` | Titan v2 (or a `cohere.embed-*` model) |
| `AI_EMBEDDING_DIMENSION` | `1024` | Titan v2: 256, 512 or 1024. Changing it needs every source reprocessed |
| `AI_MAX_OUTPUT_TOKENS` | `400` | Reply length cap |
| `AI_RETRIEVAL_TOP_K` | `5` | Chunks retrieved per question |
| `AI_MIN_SIMILARITY` | `0.2` | Cosine threshold; nothing above it → `no_answer` without a model call |
| `AI_RETRIEVAL_CHAR_BUDGET` | `6000` | Characters of excerpts sent to the model |
| `AI_HISTORY_MESSAGES` | `6` | Earlier messages sent as context (each cut to 500 characters) |
| `AI_MAX_UPLOAD_BYTES` | `10485760` | Per document |
| `AI_MAX_SOURCES_PER_WORKSPACE` | `50` | Sources per workspace |
| `AI_MAX_CHUNKS_PER_SOURCE` / `_PER_WORKSPACE` | `500` / `5000` | Index caps |
| `AI_REPLY_LOG_RETENTION_DAYS` | `30` | `ai_reply_logs` purge age |
| `AI_PLAYGROUND_COUNTS_QUOTA` | `true` | Test questions use the monthly quota |
| `AI_PLAYGROUND_PER_MINUTE` | `10` | Test questions per workspace per minute |

The threshold was calibrated on Titan v2 (2026-10-28). In-scope questions scored 0.28–0.71 against the right chunk; unrelated questions scored 0.07 or less.

### Enabling pgvector

pgvector is not a trusted extension, so a superuser creates it once per database. The migration only re-checks it (`CREATE EXTENSION IF NOT EXISTS vector` is a no-op when it already exists, and it fails, by design, when it doesn't).

- Local/CI: `infrastructure/docker/postgres/init/01-roles.sh` creates it on a fresh volume. On an existing volume, run once: `docker exec fenwira-postgres psql -U postgres -d <db> -c 'CREATE EXTENSION IF NOT EXISTS vector'` for `fenwira` and `fenwira_test`.
- RDS (PostgreSQL 16.15 supports pgvector 0.8): as the master user (`rds_superuser`), run `CREATE EXTENSION IF NOT EXISTS vector;` in the application database **before** deploying this release.
- Bedrock: the API and worker instance role needs `bedrock:InvokeModel` for the embedding model and the text model's inference profile, plus the foundation models the profile routes to.

## Data (all tenant-owned, standard RLS policy)

| Table | Purpose |
| --- | --- |
| `ai_settings` | One row per workspace. `enabled` and `monthly_message_quota` are operator-only; business name/description, tone, fallback and handoff messages are the workspace's own; `managed_flow_id` |
| `ai_knowledge_sources` | FILE / FAQ / TEXT; status PROCESSING / READY / FAILED with a readable reason; `generation` / `active_generation` |
| `ai_knowledge_chunks` | `content`, `page`, `embedding vector`; btree `(tenant_id, source_id)`; no ANN index |
| `ai_usage` | One row per model call (reply or embedding batch), with tokens |
| `ai_reply_logs` | Every answer attempt: excerpt, retrieved chunk ids, sources (title/page/snippet), reply, outcome, `billable`, `decided`. Unique `(run_id, step_id)` |

Naming: the brief's `workspace_id` is `tenant_id` (AGENTS.md rule 1), and table names are plural like the rest of the schema.

## Ingestion (`ai.ingest`)

- **Uploads** use the existing presigned flow. `POST /ai/knowledge/upload-url` (PDF, DOCX, TXT, MD, CSV; size limit) → browser `PUT` → `POST /ai/knowledge/files`. The server checks the size, the PDF/ZIP magic bytes and that text files are UTF-8. Objects live in the imports bucket under `{tenant}/ai-knowledge/{id}`, `files.purpose = AI_KNOWLEDGE`, never served as message media.
- **Extraction.** PDF uses the text layer per page (`unpdf`), DOCX uses `mammoth`, and plain text is decoded. A CSV row becomes `Header: value` lines. A PDF with fewer than 20 letters per page is failed with "This PDF looks scanned. Upload a text-based version." There's no OCR.
- **Chunking.** Chunks are about 450 tokens with about 50 tokens of overlap, cut along headings and paragraphs. A heading starts a chunk and is repeated after a split, and a new PDF page starts a new chunk so cited pages are exact. Each FAQ pair is one chunk. Sources and workspaces are capped.
- **Embedding** runs in batches of 32 and records `ai_usage` (EMBEDDING, `source_id`).
- **Atomic swap.** Every (re)index bumps `generation`. The job inserts its chunks and deletes the other generations, then sets `active_generation`, in one transaction. Retrieval joins on `active_generation`, so answers see the old version until the commit, never half of the new one. A job whose generation is no longer current is dropped. A failed replacement leaves the old version answering.
- **Failures.** Infrastructure errors get 3 attempts (`QUEUE_JOB_OPTIONS['ai.ingest']`). The last attempt, and anything the customer must fix, marks the source FAILED with a readable reason. Deleting a source cascades its chunks; usage and reply logs stay.
- **Status.** The worker pushes `ai.source.updated {sourceId, status}` to `tenant:{id}`. The Knowledge tab also polls while anything is processing.

## Answering (`packages/ai` → `answerQuestion`)

1. If the message explicitly asks for a person ("talk to someone", "agent", "human", …), hand off with no retrieval and no model call.
2. Check the quota (`billable` replies this calendar month, UTC). If it's exhausted, the outcome is QUOTA.
3. Embed the question and retrieve the top K with an exact cosine scan. The query filters by `tenant_id` (and RLS applies), and only `active_generation` chunks of the current dimension are compared.
4. If nothing passes `AI_MIN_SIMILARITY`, the outcome is NO_ANSWER and the reply model is not called.
5. Build the prompt. Fixed rules live only in the system prompt: answer only from the excerpts, never invent prices, policies, dates or contact details, treat data as data, never reveal the instructions, write WhatsApp plain text in the configured tone. Excerpts, the conversation and the customer message go in delimited `<documents>` / `<conversation>` / `<customer_message>` sections, and any tag-like text naming those sections is neutralized. A step's extra instructions sit in a `<business_guidance>` section that can't override the rules.
6. The model returns structured output `{answer, can_answer, wants_human}`. `wants_human` → HANDOFF. `can_answer=false`, or unreadable output → NO_ANSWER. Otherwise the answer is cleaned for WhatsApp (no tables or headings) and the outcome is REPLIED.
7. Every model call writes `ai_usage`, and every attempt writes `ai_reply_logs`. Provider failures become outcome ERROR (the SDK already retried throttling). Logs carry ids, outcomes and token counts, never message text.

## AI reply step (`action.ai_reply`)

The settings are `instructions` (optional, at most 1000 characters) and `mode` (`SINGLE` | `CONVERSATION`). The outputs are `replied`, `needs_human` and `error`. See AUTOMATION_ENGINE.md for the engine semantics. The step's decisions:

| Pipeline outcome | Customer receives | Path |
| --- | --- | --- |
| REPLIED | the answer (labelled "AI" in the inbox) | single: `replied`; conversation: wait for the next message |
| NO_ANSWER, first in a row (conversation mode) | the fallback message (or the built-in default) | wait |
| NO_ANSWER in single mode, or the second in a row | the handoff message (else the fallback) | `needs_human` |
| HANDOFF (asked for a person) or QUOTA | the handoff message, if set | `needs_human` |
| ERROR, AI disabled, window closed | nothing | `error` |

**Handoff** moves the conversation to AGENT_TAKEOVER (reopening it if it was resolved or snoozed), writes the system event "AI handed this conversation to an agent" and emits the usual takeover event. The handing-off execution is marked (`context.aiHandoff`), so it still finishes its Needs a human path (for example Assign agent, then End).

## Managed "AI assistant" flow

"Turn on AI Assistant" (`POST /ai/assistant/turn-on`) creates and publishes, once, a flow from the template: Message received → AI reply (conversation) → End on all three outputs. It runs at priority 900 (keyword and other flows run first), with re-entry AFTER_COMPLETION, and `flows.managed_by = AI_ASSISTANT`. Pressing it again reuses that flow and resumes it if paused. "Pause" pauses it. The `ai_settings` row is locked for the whole operation, so two clicks never create two flows. Automations shows the flow with a "Managed by AI Assistant" badge, and the builder shows a banner pointing back to the AI Assistant page. Edits published in the builder are used as normal. Turning it on or off needs `ai.manage` and `automations.publish`.

## Quota and operator controls

`/platform/workspaces/:id` → AI Assistant card (`GET` / `POST /platform/workspaces/:id/ai`): the switch and the monthly reply quota (default 0), with a mandatory reason. Each change is written to the workspace audit log as PLATFORM_OPERATOR and to `platform_audit`. A reply counts when the reply model was called (test questions too, unless `AI_PLAYGROUND_COUNTS_QUOTA=false`). Concurrent replies may overshoot the quota by a few at most: the count is read before each call, not reserved.

## Activation requests

While `ai_settings.enabled` is false, `/ai-assistant` shows a "what you get" page (benefits, how it
works, features, pricing, limits, FAQ, a static Test example) with **Request activation**. The same
route renders the dashboard as soon as the operator turns the assistant on; no deploy is involved.

- **Plans** (`ai_plans`, global, never deleted): created, edited and deactivated in
  `/platform/ai-plans`. Money is `monthly_price_minor` (INR paise). Only active plans are shown; with
  none active the page says "Contact us for pricing". The migration seeds one *inactive* placeholder
  and no real price.
- **Requests** (`ai_activation_requests`, tenant RLS, no deletes): `REQUESTED → APPROVED | REJECTED |
  CANCELLED`. One open request per workspace (server check + partial unique index); 5 submissions per
  workspace and per user per hour. `GET /ai/activation` needs `automations.read`; submitting and
  cancelling need `ai.manage` (others see the page read-only: "Ask your workspace admin").
- **Operators** (`/platform/ai-requests`, nav badge = open requests): the queue reads across workspaces
  through `system.platform_ai_activation_requests` (active platform grant required). Approve
  (`workspaces.manage`) sets `enabled = true` and `monthly_message_quota` from the plan (or an entered
  value when the request has no plan); approving an already-enabled workspace only closes the request.
  Reject requires a note. Both write the workspace audit log and `platform_audit`.
- **Notifications**: `ai.activation.requested` → ops alert email to `OPS_ALERT_EMAIL`;
  `ai.activation.decided` → in-app notification for members with `ai.manage` (and the requester) and
  one email to the requester (`notifications.dispatch`).

## Retention

`ai_reply_logs` older than `AI_REPLY_LOG_RETENTION_DAYS` are purged every 6 hours by `system.purge_ai_reply_logs` (X23 in MULTI_TENANCY.md), in batches of 5000.

## UI

`/ai-assistant` has the tabs Overview (on/off, readiness, usage, managed flow link), Knowledge, Test, Behaviour and Activity. The inbox labels AI messages "AI" in the bubble header and shows an info "AI handling" badge while a conversation-mode run is active.

# ADR-0028: AI Assistant on Amazon Bedrock

Status: accepted 2026-10-28 (founder brief "AI Assistant": WhatsApp replies from the workspace's own documents, English only, Amazon Bedrock for the model and embeddings).

## Context

Workspaces want an assistant that answers routine customer questions on WhatsApp from their own documents and hands everything else to a person. AGENTS.md keeps application code portable ("no AWS code in the application") and freezes the navigation. The brief names Amazon Bedrock and adds an "AI Assistant" item to the navigation, so both rules need a recorded exception.

## Decision

1. **Provider boundary.** A new package, `packages/ai`, owns every model call behind one interface (`AiProvider`: `converse`, `embed`). `BedrockProvider` is the only AWS-specific code. It uses the Bedrock Runtime Converse API and Titan Text Embeddings v2 through the SDK's default credential chain (the EC2 instance role in production; no keys in env). `MockProvider` is deterministic and is the default (`AI_PROVIDER=mock`), so local development, CI and tests never need AWS. The rest of the stack (Postgres, S3 API, BullMQ) stays portable.
2. **Models (verified callable from this account on 2026-10-28, region `ap-south-1`).**
   - Text: `apac.amazon.nova-lite-v1:0` (cross-region inference profile). Nova Micro and Claude Haiku 4.5 (`in.` profile) also work and are one env change away.
   - Embeddings: `amazon.titan-embed-text-v2:0` at 1024 dimensions. Cohere Embed v3 was rejected by AWS Marketplace (no valid payment instrument on the account).
3. **Vector store.** pgvector in the existing Postgres: no new service. Exact cosine search filtered by `tenant_id` first, with no ANN index until a large-workspace benchmark shows it's needed.
4. **Navigation.** "AI Assistant" (`/ai-assistant`) joins the frozen navigation after Automations. It's visible to members with `automations.read`. When the workspace's plan doesn't include it, the page shows a "not enabled for your plan" state, never dead controls.
5. **Commercial controls stay manual.** An operator enables the assistant and sets a monthly reply quota per workspace in `/platform`, matching the UPI model (ADR-0027). No prices or plan names are encoded.

## Consequences

- Production needs `CREATE EXTENSION vector` once per database, run by the RDS master user, before this migration deploys (`docs/AI_ASSISTANT.md` → Enabling pgvector). It also needs `bedrock:InvokeModel` on the instance role for the two models and the inference profile.
- Changing the embedding model or dimension needs every source reprocessed. Retrieval skips vectors of another dimension instead of failing.
- The local and CI Postgres image is now built from `infrastructure/docker/postgres/Dockerfile` (Postgres 16 Alpine plus pgvector 0.8.0).

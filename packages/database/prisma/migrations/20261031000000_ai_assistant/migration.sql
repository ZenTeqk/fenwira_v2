-- AI Assistant (docs/AI_ASSISTANT.md). pgvector is not a trusted extension: a superuser creates it
-- once per database (infrastructure/docker/postgres/init/01-roles.sh locally; the RDS master user
-- in production, docs/AI_ASSISTANT.md → Enabling pgvector). With the extension already present
-- this statement is a no-op for fenwira_owner; without it the migration stops here, by design.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE "ai_tone" AS ENUM ('FRIENDLY', 'PROFESSIONAL', 'CONCISE');
CREATE TYPE "ai_source_type" AS ENUM ('FILE', 'FAQ', 'TEXT');
CREATE TYPE "ai_source_status" AS ENUM ('PROCESSING', 'READY', 'FAILED');
CREATE TYPE "ai_usage_kind" AS ENUM ('REPLY', 'EMBEDDING');
CREATE TYPE "ai_reply_outcome" AS ENUM ('REPLIED', 'NO_ANSWER', 'HANDOFF', 'QUOTA', 'ERROR');

-- Knowledge documents are uploaded files with their own purpose (never served as message media).
ALTER TYPE "file_purpose" ADD VALUE IF NOT EXISTS 'AI_KNOWLEDGE';

ALTER TABLE "messages" ADD COLUMN "ai_generated" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ai_settings" (
    "tenant_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "monthly_message_quota" INTEGER NOT NULL DEFAULT 0,
    "business_name" TEXT,
    "business_description" TEXT,
    "tone" "ai_tone" NOT NULL DEFAULT 'FRIENDLY',
    "fallback_message" TEXT,
    "handoff_message" TEXT,
    "managed_flow_id" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ai_settings_pkey" PRIMARY KEY ("tenant_id")
);

CREATE TABLE "ai_knowledge_sources" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "ai_source_type" NOT NULL,
    "title" TEXT NOT NULL,
    "file_id" UUID,
    "body" JSONB,
    "status" "ai_source_status" NOT NULL DEFAULT 'PROCESSING',
    "failure_reason" TEXT,
    "chunk_count" INTEGER NOT NULL DEFAULT 0,
    "size_bytes" BIGINT NOT NULL DEFAULT 0,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "active_generation" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ai_knowledge_sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_knowledge_chunks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "generation" INTEGER NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "page" INTEGER,
    "embedding" vector NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_knowledge_chunks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_usage" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID,
    "run_id" UUID,
    "step_id" TEXT,
    "source_id" UUID,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "kind" "ai_usage_kind" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_reply_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID,
    "run_id" UUID,
    "step_id" TEXT,
    "customer_message_excerpt" TEXT NOT NULL,
    "retrieved_chunk_ids" UUID[],
    "sources" JSONB NOT NULL DEFAULT '[]',
    "reply" TEXT,
    "outcome" "ai_reply_outcome" NOT NULL,
    "billable" BOOLEAN NOT NULL DEFAULT false,
    "playground" BOOLEAN NOT NULL DEFAULT false,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_reply_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_knowledge_sources_tenant_id_created_at_idx" ON "ai_knowledge_sources"("tenant_id", "created_at" DESC);
CREATE INDEX "ai_knowledge_chunks_tenant_id_source_id_idx" ON "ai_knowledge_chunks"("tenant_id", "source_id");
CREATE INDEX "ai_usage_tenant_id_created_at_idx" ON "ai_usage"("tenant_id", "created_at");
CREATE UNIQUE INDEX "ai_reply_logs_run_id_step_id_key" ON "ai_reply_logs"("run_id", "step_id");
CREATE INDEX "ai_reply_logs_tenant_id_created_at_idx" ON "ai_reply_logs"("tenant_id", "created_at" DESC);
CREATE INDEX "ai_reply_logs_tenant_id_conversation_id_created_at_idx" ON "ai_reply_logs"("tenant_id", "conversation_id", "created_at" DESC);

ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_knowledge_sources" ADD CONSTRAINT "ai_knowledge_sources_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_knowledge_chunks" ADD CONSTRAINT "ai_knowledge_chunks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_knowledge_chunks" ADD CONSTRAINT "ai_knowledge_chunks_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "ai_knowledge_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_reply_logs" ADD CONSTRAINT "ai_reply_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

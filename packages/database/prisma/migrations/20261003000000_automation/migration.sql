-- CreateEnum
CREATE TYPE "flow_status" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "flow_version_state" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "reentry_policy" AS ENUM ('ALWAYS', 'ONCE_PER_CONTACT', 'AFTER_COMPLETION');

-- CreateEnum
CREATE TYPE "execution_status" AS ENUM ('RUNNING', 'WAITING', 'COMPLETED', 'FAILED', 'CANCELLED', 'STOPPED_TAKEOVER');

-- CreateEnum
CREATE TYPE "step_status" AS ENUM ('SUCCEEDED', 'FAILED', 'SKIPPED', 'WAITING');

-- CreateEnum
CREATE TYPE "trigger_run_status" AS ENUM ('RUNNING', 'COMPLETED', 'STOPPED');

-- CreateTable
CREATE TABLE "flows" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "flow_status" NOT NULL DEFAULT 'DRAFT',
    "active_version_id" UUID,
    "draft_version_id" UUID,
    "reentry_policy" "reentry_policy" NOT NULL DEFAULT 'AFTER_COMPLETION',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "webhook_token_hash" BYTEA,
    "webhook_secret_ciphertext" BYTEA,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_versions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "flow_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "graph" JSONB NOT NULL,
    "trigger_type" TEXT,
    "trigger_config" JSONB,
    "state" "flow_version_state" NOT NULL DEFAULT 'DRAFT',
    "validation_errors" JSONB,
    "published_by" UUID,
    "published_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "flow_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_trigger_runs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "trigger_type" TEXT NOT NULL,
    "contact_id" UUID NOT NULL,
    "conversation_id" UUID,
    "trigger_event" JSONB NOT NULL,
    "plan" JSONB NOT NULL,
    "status" "trigger_run_status" NOT NULL DEFAULT 'RUNNING',
    "stop_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "automation_trigger_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_executions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "flow_id" UUID NOT NULL,
    "flow_version_id" UUID NOT NULL,
    "trigger_run_id" UUID,
    "contact_id" UUID NOT NULL,
    "conversation_id" UUID,
    "trigger_event" JSONB NOT NULL,
    "status" "execution_status" NOT NULL DEFAULT 'RUNNING',
    "current_node_id" TEXT,
    "wait_until" TIMESTAMPTZ(3),
    "context" JSONB NOT NULL DEFAULT '{}',
    "step_count" INTEGER NOT NULL DEFAULT 0,
    "error_code" TEXT,
    "error_detail" TEXT,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "automation_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_execution_steps" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "execution_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "node_id" TEXT NOT NULL,
    "node_type" TEXT NOT NULL,
    "status" "step_status" NOT NULL,
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB NOT NULL DEFAULT '{}',
    "error_code" TEXT,
    "error_detail" TEXT,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "automation_execution_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "flows_webhook_token_hash_key" ON "flows"("webhook_token_hash");

-- CreateIndex
CREATE INDEX "flows_tenant_id_status_idx" ON "flows"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "flow_versions_tenant_id_trigger_type_state_idx" ON "flow_versions"("tenant_id", "trigger_type", "state");

-- CreateIndex
CREATE UNIQUE INDEX "flow_versions_flow_id_version_key" ON "flow_versions"("flow_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "automation_trigger_runs_tenant_id_event_id_key" ON "automation_trigger_runs"("tenant_id", "event_id");

-- CreateIndex
CREATE INDEX "automation_executions_tenant_id_flow_id_started_at_idx" ON "automation_executions"("tenant_id", "flow_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "automation_executions_tenant_id_conversation_id_status_idx" ON "automation_executions"("tenant_id", "conversation_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "automation_executions_trigger_run_id_flow_id_key" ON "automation_executions"("trigger_run_id", "flow_id");

-- CreateIndex
CREATE UNIQUE INDEX "automation_execution_steps_execution_id_seq_key" ON "automation_execution_steps"("execution_id", "seq");

-- AddForeignKey
ALTER TABLE "flows" ADD CONSTRAINT "flows_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_versions" ADD CONSTRAINT "flow_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_versions" ADD CONSTRAINT "flow_versions_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "flows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_trigger_runs" ADD CONSTRAINT "automation_trigger_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_executions" ADD CONSTRAINT "automation_executions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_executions" ADD CONSTRAINT "automation_executions_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "flows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_executions" ADD CONSTRAINT "automation_executions_flow_version_id_fkey" FOREIGN KEY ("flow_version_id") REFERENCES "flow_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_executions" ADD CONSTRAINT "automation_executions_trigger_run_id_fkey" FOREIGN KEY ("trigger_run_id") REFERENCES "automation_trigger_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_execution_steps" ADD CONSTRAINT "automation_execution_steps_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_execution_steps" ADD CONSTRAINT "automation_execution_steps_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "automation_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;


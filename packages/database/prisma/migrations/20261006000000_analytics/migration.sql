-- Phase 11 Step 2: analytics projections (docs/ANALYTICS.md). RLS policies and append-only
-- grants are applied by post-migrate.sql (every tenant_id table; analytics_events is AO).

-- CreateTable
CREATE TABLE "analytics_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "source_event_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "subject_id" UUID,
    "dims" JSONB NOT NULL DEFAULT '{}',
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_daily_rollups" (
    "tenant_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "metric" TEXT NOT NULL,
    "dims_key" TEXT NOT NULL DEFAULT '',
    "value" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_daily_rollups_pkey" PRIMARY KEY ("tenant_id","day","metric","dims_key")
);

-- CreateTable
CREATE TABLE "analytics_conversation_episodes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "opened_at" TIMESTAMPTZ(3) NOT NULL,
    "day" DATE NOT NULL,
    "first_response_at" TIMESTAMPTZ(3),
    "first_responder_id" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_conversation_episodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_dirty" (
    "tenant_id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "marked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_dirty_pkey" PRIMARY KEY ("tenant_id","scope","key")
);

-- CreateTable
CREATE TABLE "analytics_tenant_state" (
    "tenant_id" UUID NOT NULL,
    "timezone" TEXT,
    "retention_days" INTEGER,
    "backfilled_at" TIMESTAMPTZ(3),
    "last_event_at" TIMESTAMPTZ(3),
    "last_rollup_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "last_error_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_tenant_state_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateIndex
CREATE INDEX "analytics_events_tenant_id_event_type_occurred_at_idx" ON "analytics_events"("tenant_id", "event_type", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_events_tenant_id_source_event_id_key" ON "analytics_events"("tenant_id", "source_event_id");

-- CreateIndex
CREATE INDEX "analytics_daily_rollups_tenant_id_metric_day_idx" ON "analytics_daily_rollups"("tenant_id", "metric", "day");

-- CreateIndex
CREATE INDEX "analytics_conversation_episodes_tenant_id_day_idx" ON "analytics_conversation_episodes"("tenant_id", "day");

-- CreateIndex
CREATE INDEX "analytics_conversation_episodes_tenant_id_conversation_id_o_idx" ON "analytics_conversation_episodes"("tenant_id", "conversation_id", "opened_at");

-- Source-table indexes for bounded per-day analytics scans and Contact → Campaigns.
-- CreateIndex
CREATE INDEX "messages_tenant_id_created_at_idx" ON "messages"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "automation_executions_tenant_id_started_at_idx" ON "automation_executions"("tenant_id", "started_at");

-- CreateIndex
CREATE INDEX "automation_execution_steps_tenant_id_started_at_idx" ON "automation_execution_steps"("tenant_id", "started_at");

-- CreateIndex
CREATE INDEX "usage_events_tenant_id_occurred_at_idx" ON "usage_events"("tenant_id", "occurred_at");

-- CreateIndex
CREATE INDEX "campaign_recipients_tenant_id_contact_id_created_at_idx" ON "campaign_recipients"("tenant_id", "contact_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_daily_rollups" ADD CONSTRAINT "analytics_daily_rollups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_conversation_episodes" ADD CONSTRAINT "analytics_conversation_episodes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_dirty" ADD CONSTRAINT "analytics_dirty_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_tenant_state" ADD CONSTRAINT "analytics_tenant_state_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

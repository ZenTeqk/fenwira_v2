-- Follow-ups, sales stages and opportunities, and response alerts (docs/FOLLOW_UPS_AND_SALES.md,
-- docs/RESPONSE_ALERTS.md). Additive only: new enums, tables and one tenants column (default off).
-- RLS for every new table comes from post-migrate.sql (tenant_id). No data is backfilled: stages
-- are created per workspace on first use, and no opportunities or alerts are generated for
-- existing conversations.
-- CreateEnum
CREATE TYPE "sales_outcome" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "follow_up_status" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "sales_followups_enabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "sales_stages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT,
    "name" TEXT NOT NULL,
    "outcome" "sales_outcome" NOT NULL,
    "position" INTEGER NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunities" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "conversation_id" UUID,
    "stage_id" UUID NOT NULL,
    "status" "sales_outcome" NOT NULL DEFAULT 'OPEN',
    "owner_id" UUID,
    "title" TEXT,
    "expected_value_minor" BIGINT,
    "currency" CHAR(3),
    "closed_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_ups" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "conversation_id" UUID,
    "opportunity_id" UUID,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "assignee_id" UUID NOT NULL,
    "created_by" UUID,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "follow_up_status" NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "due_notified_at" TIMESTAMPTZ(3),
    "needs_review_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "completed_by" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_wait_episodes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "start_message_id" UUID,
    "bot_handling" BOOLEAN NOT NULL DEFAULT false,
    "clock_started_at" TIMESTAMPTZ(3),
    "next_check_at" TIMESTAMPTZ(3),
    "unassigned_alerted_at" TIMESTAMPTZ(3),
    "response_alerted_at" TIMESTAMPTZ(3),
    "escalated_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "end_reason" TEXT,
    "end_message_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "conversation_wait_episodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "response_alert_settings" (
    "tenant_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "enabled_at" TIMESTAMPTZ(3),
    "unassigned_minutes" INTEGER NOT NULL DEFAULT 5,
    "response_minutes" INTEGER NOT NULL DEFAULT 15,
    "escalation_minutes" INTEGER NOT NULL DEFAULT 30,
    "escalation_user_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "issue_code" TEXT,
    "issue_message" TEXT,
    "issue_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "response_alert_settings_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateIndex
CREATE INDEX "sales_stages_tenant_id_position_idx" ON "sales_stages"("tenant_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "sales_stages_tenant_id_key_key" ON "sales_stages"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "opportunities_tenant_id_contact_id_created_at_idx" ON "opportunities"("tenant_id", "contact_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "opportunities_tenant_id_status_stage_id_idx" ON "opportunities"("tenant_id", "status", "stage_id");

-- CreateIndex
CREATE INDEX "opportunities_tenant_id_status_owner_id_idx" ON "opportunities"("tenant_id", "status", "owner_id");

-- CreateIndex
CREATE INDEX "follow_ups_tenant_id_assignee_id_status_due_at_idx" ON "follow_ups"("tenant_id", "assignee_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "follow_ups_tenant_id_status_due_at_idx" ON "follow_ups"("tenant_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "follow_ups_tenant_id_contact_id_status_idx" ON "follow_ups"("tenant_id", "contact_id", "status");

-- CreateIndex
CREATE INDEX "follow_ups_tenant_id_conversation_id_status_idx" ON "follow_ups"("tenant_id", "conversation_id", "status");

-- CreateIndex
CREATE INDEX "follow_ups_tenant_id_opportunity_id_status_idx" ON "follow_ups"("tenant_id", "opportunity_id", "status");

-- CreateIndex
CREATE INDEX "conversation_wait_episodes_tenant_id_conversation_id_starte_idx" ON "conversation_wait_episodes"("tenant_id", "conversation_id", "started_at" DESC);

-- AddForeignKey
ALTER TABLE "sales_stages" ADD CONSTRAINT "sales_stages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "sales_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_wait_episodes" ADD CONSTRAINT "conversation_wait_episodes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_wait_episodes" ADD CONSTRAINT "conversation_wait_episodes_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "response_alert_settings" ADD CONSTRAINT "response_alert_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Integrity the Prisma schema can't express.
ALTER TABLE "response_alert_settings" ALTER COLUMN "escalation_user_ids" SET NOT NULL;
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_value_check"
  CHECK (("expected_value_minor" IS NULL OR "expected_value_minor" >= 0)
     AND (("expected_value_minor" IS NULL) = ("currency" IS NULL)));
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_closed_check"
  CHECK (("status" = 'OPEN') = ("closed_at" IS NULL));
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_title_check" CHECK (length("title") BETWEEN 1 AND 200);
ALTER TABLE "sales_stages" ADD CONSTRAINT "sales_stages_name_check" CHECK (length("name") BETWEEN 1 AND 40);
ALTER TABLE "response_alert_settings" ADD CONSTRAINT "response_alert_settings_minutes_check"
  CHECK ("unassigned_minutes" BETWEEN 1 AND 1440 AND "response_minutes" BETWEEN 1 AND 1440
     AND "escalation_minutes" BETWEEN 1 AND 1440);

-- One open opportunity per contact (repeat purchases start a new one after closing).
CREATE UNIQUE INDEX "opportunities_one_open_per_contact"
  ON "opportunities"("tenant_id", "contact_id") WHERE "status" = 'OPEN';
-- Active stage names are unique per workspace (case-insensitive); archived names may repeat.
CREATE UNIQUE INDEX "sales_stages_active_name"
  ON "sales_stages"("tenant_id", lower("name")) WHERE "archived_at" IS NULL;
-- One open waiting episode per conversation.
CREATE UNIQUE INDEX "conversation_wait_episodes_one_open"
  ON "conversation_wait_episodes"("conversation_id") WHERE "ended_at" IS NULL;
-- Bounded sweeps: only rows with work due are indexed.
CREATE INDEX "follow_ups_due_unnotified"
  ON "follow_ups"("due_at") WHERE "status" = 'PENDING' AND "due_notified_at" IS NULL;
CREATE INDEX "conversation_wait_episodes_next_check"
  ON "conversation_wait_episodes"("next_check_at")
  WHERE "ended_at" IS NULL AND "next_check_at" IS NOT NULL;

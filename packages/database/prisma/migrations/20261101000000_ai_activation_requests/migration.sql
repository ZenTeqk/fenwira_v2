-- AI Assistant activation requests and operator-managed AI plans (docs/AI_ASSISTANT.md →
-- Activation requests). RLS on ai_activation_requests comes from post-migrate.sql (tenant_id).
CREATE TYPE "ai_activation_status" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED');

CREATE TABLE "ai_plans" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "monthly_price_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "included_replies" INTEGER NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ai_plans_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_plans_price_check" CHECK ("monthly_price_minor" >= 0),
    CONSTRAINT "ai_plans_replies_check" CHECK ("included_replies" >= 0)
);

CREATE TABLE "ai_activation_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "plan_id" UUID,
    "expected_conversations" INTEGER NOT NULL,
    "use_case" TEXT NOT NULL,
    "contact_email" TEXT NOT NULL,
    "contact_phone" TEXT,
    "status" "ai_activation_status" NOT NULL DEFAULT 'REQUESTED',
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "decision_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ai_activation_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_activation_requests_tenant_id_created_at_idx" ON "ai_activation_requests"("tenant_id", "created_at" DESC);
CREATE INDEX "ai_activation_requests_status_created_at_idx" ON "ai_activation_requests"("status", "created_at");
-- One open request per workspace: the server pre-checks, and this makes it impossible to race.
CREATE UNIQUE INDEX "ai_activation_requests_one_open_key" ON "ai_activation_requests"("tenant_id") WHERE "status" = 'REQUESTED';

ALTER TABLE "ai_activation_requests" ADD CONSTRAINT "ai_activation_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_activation_requests" ADD CONSTRAINT "ai_activation_requests_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "ai_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One inactive placeholder so the console has something to edit. No real price is seeded.
INSERT INTO "ai_plans" ("id", "name", "monthly_price_minor", "currency", "included_replies", "description", "active", "sort_order", "updated_at")
VALUES ('0193a000-0000-7000-8000-000000000a11', 'Placeholder plan (edit before activating)', 0, 'INR', 0, 'Set the real price and included replies in /platform → AI plans, then activate.', false, 0, CURRENT_TIMESTAMP);

-- CreateEnum
CREATE TYPE "campaign_status" AS ENUM ('DRAFT', 'SCHEDULED', 'PREPARING', 'RUNNING', 'PAUSED', 'PAUSED_INSUFFICIENT_FUNDS', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "recipient_status" AS ENUM ('PENDING', 'QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "wallet_transaction_type" AS ENUM ('CREDIT', 'DEBIT', 'ADJUSTMENT', 'REFUND');

-- CreateEnum
CREATE TYPE "reservation_status" AS ENUM ('ACTIVE', 'SETTLED', 'RELEASED');

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "campaign_status" NOT NULL DEFAULT 'DRAFT',
    "pause_reason" TEXT,
    "failure_reason" TEXT,
    "phone_number_id" UUID,
    "template_version_id" UUID,
    "template_snapshot" JSONB,
    "audience" JSONB NOT NULL,
    "variable_mapping" JSONB NOT NULL,
    "schedule_at" TIMESTAMPTZ(3),
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "rate_limit_per_minute" INTEGER,
    "total_recipients" INTEGER NOT NULL DEFAULT 0,
    "audience_snapshot_at" TIMESTAMPTZ(3),
    "dispatch_generation" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID,
    "launched_by" UUID,
    "launched_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "paused_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_recipients" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "phone_e164" TEXT NOT NULL,
    "contact_name" TEXT,
    "variables" JSONB NOT NULL,
    "status" "recipient_status" NOT NULL DEFAULT 'PENDING',
    "skip_reason" TEXT,
    "error_code" TEXT,
    "message_id" UUID,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "queued_at" TIMESTAMPTZ(3),
    "sent_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "read_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "balance_minor" BIGINT NOT NULL DEFAULT 0,
    "credit_limit_minor" BIGINT NOT NULL DEFAULT 0,
    "reserved_minor" BIGINT NOT NULL DEFAULT 0,
    "low_balance_threshold_minor" BIGINT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_transactions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "type" "wallet_transaction_type" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "balance_after_minor" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "reference_type" TEXT,
    "reference_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_reservations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "status" "reservation_status" NOT NULL DEFAULT 'ACTIVE',
    "settled_transaction_id" UUID,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "wallet_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "message_id" UUID,
    "category" TEXT NOT NULL,
    "country" CHAR(2),
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price_minor" BIGINT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "pricing_ref" JSONB,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_book_entries" (
    "id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "country" CHAR(2),
    "currency" CHAR(3) NOT NULL,
    "unit_price_minor" BIGINT NOT NULL,
    "markup_bps" INTEGER NOT NULL DEFAULT 0,
    "effective_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_to" TIMESTAMPTZ(3),

    CONSTRAINT "price_book_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaigns_tenant_id_status_idx" ON "campaigns"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "campaigns_tenant_id_created_at_idx" ON "campaigns"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "campaign_recipients_message_id_key" ON "campaign_recipients"("message_id");

-- CreateIndex
CREATE INDEX "campaign_recipients_campaign_id_status_id_idx" ON "campaign_recipients"("campaign_id", "status", "id");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_recipients_campaign_id_contact_id_key" ON "campaign_recipients"("campaign_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_tenant_id_key" ON "wallets"("tenant_id");

-- CreateIndex
CREATE INDEX "wallet_transactions_wallet_id_created_at_idx" ON "wallet_transactions"("wallet_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transactions_tenant_id_idempotency_key_key" ON "wallet_transactions"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_reservations_message_id_key" ON "wallet_reservations"("message_id");

-- CreateIndex
CREATE INDEX "wallet_reservations_wallet_id_status_idx" ON "wallet_reservations"("wallet_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "usage_events_tenant_id_type_message_id_key" ON "usage_events"("tenant_id", "type", "message_id");

-- CreateIndex
CREATE INDEX "price_book_entries_category_country_effective_from_idx" ON "price_book_entries"("category", "country", "effective_from");

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_template_version_id_fkey" FOREIGN KEY ("template_version_id") REFERENCES "template_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_reservations" ADD CONSTRAINT "wallet_reservations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_reservations" ADD CONSTRAINT "wallet_reservations_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_reservations" ADD CONSTRAINT "wallet_reservations_settled_transaction_id_fkey" FOREIGN KEY ("settled_transaction_id") REFERENCES "wallet_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


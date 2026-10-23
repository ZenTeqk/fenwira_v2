-- ADR-0027 step 4: email delivery log and suppression list (global; no tenant data, no address, no body).
-- CreateEnum
CREATE TYPE "email_delivery_status" AS ENUM ('SENT', 'FAILED', 'SKIPPED_NO_SMTP', 'SUPPRESSED');

-- CreateTable
CREATE TABLE "email_deliveries" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "email_delivery_status" NOT NULL,
    "recipient_hash" BYTEA NOT NULL,
    "recipient_hint" TEXT NOT NULL,
    "error_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_suppressions" (
    "recipient_hash" BYTEA NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_suppressions_pkey" PRIMARY KEY ("recipient_hash")
);

-- CreateIndex
CREATE INDEX "email_deliveries_created_at_id_idx" ON "email_deliveries"("created_at" DESC, "id");

-- CreateIndex
CREATE INDEX "email_deliveries_recipient_hash_idx" ON "email_deliveries"("recipient_hash");


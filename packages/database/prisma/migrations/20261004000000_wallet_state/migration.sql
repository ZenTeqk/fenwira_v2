-- Phase 11 Step 1: wallet state (P11-D12), fund types (P11-D7), notification dedupe.

-- CreateEnum
CREATE TYPE "fund_type" AS ENUM ('PAID', 'PROMOTIONAL');

-- CreateEnum
CREATE TYPE "wallet_funds_state" AS ENUM ('NORMAL', 'LOW_BALANCE', 'INSUFFICIENT_FUNDS');

-- AlterTable
ALTER TABLE "wallets" ADD COLUMN     "funds_state" "wallet_funds_state";

-- AlterTable (P11-D7). Append-only for the runtime role; this migration runs as the owner and
-- classifies the Phase 9 trial credits, which were written with reference_type 'promotion'.
ALTER TABLE "wallet_transactions" ADD COLUMN     "expires_at" TIMESTAMPTZ(3),
ADD COLUMN     "fund_type" "fund_type" NOT NULL DEFAULT 'PAID';
UPDATE "wallet_transactions" SET "fund_type" = 'PROMOTIONAL' WHERE "reference_type" = 'promotion';

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "dedupe_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "notifications_tenant_id_user_id_dedupe_key_key" ON "notifications"("tenant_id", "user_id", "dedupe_key");

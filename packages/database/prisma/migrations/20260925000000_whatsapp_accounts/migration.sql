-- CreateEnum
CREATE TYPE "waba_status" AS ENUM ('ACTIVE', 'RESTRICTED', 'DISABLED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "quality_rating" AS ENUM ('GREEN', 'YELLOW', 'RED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "phone_status" AS ENUM ('PENDING', 'CONNECTED', 'FLAGGED', 'RESTRICTED', 'DISCONNECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "meta_token_type" AS ENUM ('BUSINESS_INTEGRATION', 'SYSTEM_USER', 'DEV');

-- CreateEnum
CREATE TYPE "credential_status" AS ENUM ('VALID', 'EXPIRING', 'INVALID', 'REVOKED');

-- CreateEnum
CREATE TYPE "webhook_subscription_status" AS ENUM ('ACTIVE', 'FAILED', 'REMOVED');

-- CreateTable
CREATE TABLE "meta_business_accounts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "meta_business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "meta_business_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_business_accounts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "meta_business_account_id" UUID,
    "waba_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" CHAR(3),
    "timezone_id" TEXT,
    "message_template_namespace" TEXT,
    "status" "waba_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "whatsapp_business_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_phone_numbers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "waba_id" UUID NOT NULL,
    "phone_number_id" TEXT NOT NULL,
    "display_phone_number" TEXT NOT NULL,
    "verified_name" TEXT NOT NULL,
    "label" TEXT,
    "quality_rating" "quality_rating" NOT NULL DEFAULT 'UNKNOWN',
    "messaging_limit_tier" TEXT,
    "throughput_mps" INTEGER NOT NULL DEFAULT 80,
    "status" "phone_status" NOT NULL DEFAULT 'PENDING',
    "status_detail" JSONB,
    "registration_pin_ciphertext" BYTEA,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "last_synced_at" TIMESTAMPTZ(3),
    "connected_at" TIMESTAMPTZ(3),
    "disconnected_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "whatsapp_phone_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta_credentials" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "waba_id" UUID NOT NULL,
    "token_ciphertext" BYTEA,
    "token_last4" TEXT NOT NULL,
    "token_prefix" TEXT NOT NULL,
    "token_type" "meta_token_type" NOT NULL,
    "scopes" TEXT[],
    "expires_at" TIMESTAMPTZ(3),
    "status" "credential_status" NOT NULL DEFAULT 'VALID',
    "last_checked_at" TIMESTAMPTZ(3),
    "rotated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "meta_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_subscriptions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "waba_id" UUID NOT NULL,
    "subscribed_fields" TEXT[],
    "status" "webhook_subscription_status" NOT NULL DEFAULT 'ACTIVE',
    "last_event_at" TIMESTAMPTZ(3),
    "last_checked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "webhook_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "meta_business_accounts_tenant_id_meta_business_id_key" ON "meta_business_accounts"("tenant_id", "meta_business_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_business_accounts_tenant_id_waba_id_key" ON "whatsapp_business_accounts"("tenant_id", "waba_id");

-- CreateIndex
CREATE INDEX "whatsapp_phone_numbers_tenant_id_status_idx" ON "whatsapp_phone_numbers"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_phone_numbers_tenant_id_phone_number_id_key" ON "whatsapp_phone_numbers"("tenant_id", "phone_number_id");

-- CreateIndex
CREATE INDEX "meta_credentials_tenant_id_waba_id_idx" ON "meta_credentials"("tenant_id", "waba_id");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_subscriptions_tenant_id_waba_id_key" ON "webhook_subscriptions"("tenant_id", "waba_id");

-- AddForeignKey
ALTER TABLE "meta_business_accounts" ADD CONSTRAINT "meta_business_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_business_accounts" ADD CONSTRAINT "whatsapp_business_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_business_accounts" ADD CONSTRAINT "whatsapp_business_accounts_meta_business_account_id_fkey" FOREIGN KEY ("meta_business_account_id") REFERENCES "meta_business_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_phone_numbers" ADD CONSTRAINT "whatsapp_phone_numbers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_phone_numbers" ADD CONSTRAINT "whatsapp_phone_numbers_waba_id_fkey" FOREIGN KEY ("waba_id") REFERENCES "whatsapp_business_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_credentials" ADD CONSTRAINT "meta_credentials_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_credentials" ADD CONSTRAINT "meta_credentials_waba_id_fkey" FOREIGN KEY ("waba_id") REFERENCES "whatsapp_business_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_waba_id_fkey" FOREIGN KEY ("waba_id") REFERENCES "whatsapp_business_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;


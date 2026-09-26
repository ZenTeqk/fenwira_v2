-- CreateEnum
CREATE TYPE "template_category" AS ENUM ('MARKETING', 'UTILITY', 'AUTHENTICATION');

-- CreateEnum
CREATE TYPE "template_status" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "template_origin" AS ENUM ('FENWIRA', 'META');

-- AlterTable
ALTER TABLE "whatsapp_business_accounts" ADD COLUMN     "templates_synced_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "template_version_id" UUID;

-- CreateTable
CREATE TABLE "templates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "waba_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "category" "template_category" NOT NULL,
    "status" "template_status" NOT NULL DEFAULT 'DRAFT',
    "current_version_id" UUID,
    "approved_version_id" UUID,
    "quality_score" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_versions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "components" JSONB NOT NULL,
    "variable_samples" JSONB NOT NULL,
    "sample_file_id" UUID,
    "meta_template_id" TEXT,
    "status" "template_status" NOT NULL DEFAULT 'DRAFT',
    "origin" "template_origin" NOT NULL DEFAULT 'FENWIRA',
    "quality_score" TEXT,
    "rejection_reason" TEXT,
    "last_error" TEXT,
    "submitted_at" TIMESTAMPTZ(3),
    "decided_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "templates_tenant_id_status_idx" ON "templates"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "template_versions_tenant_id_meta_template_id_idx" ON "template_versions"("tenant_id", "meta_template_id");

-- CreateIndex
CREATE UNIQUE INDEX "template_versions_template_id_version_key" ON "template_versions"("template_id", "version");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_template_version_id_fkey" FOREIGN KEY ("template_version_id") REFERENCES "template_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "templates" ADD CONSTRAINT "templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "templates" ADD CONSTRAINT "templates_waba_id_fkey" FOREIGN KEY ("waba_id") REFERENCES "whatsapp_business_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_sample_file_id_fkey" FOREIGN KEY ("sample_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


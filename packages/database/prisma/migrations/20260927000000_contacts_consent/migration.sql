-- CreateEnum
CREATE TYPE "consent_state" AS ENUM ('NONE', 'GRANTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "property_type" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT');

-- CreateEnum
CREATE TYPE "tag_color" AS ENUM ('NEUTRAL', 'PRIMARY', 'INFO', 'WARNING', 'DANGER', 'SUCCESS');

-- CreateEnum
CREATE TYPE "consent_channel" AS ENUM ('WHATSAPP');

-- CreateEnum
CREATE TYPE "consent_purpose" AS ENUM ('MARKETING', 'UTILITY', 'SERVICE');

-- CreateEnum
CREATE TYPE "consent_status" AS ENUM ('GRANTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "consent_source" AS ENUM ('INBOUND_KEYWORD', 'MANUAL', 'IMPORT', 'API', 'FORM', 'META_OPT_OUT');

-- CreateEnum
CREATE TYPE "import_status" AS ENUM ('UPLOADED', 'MAPPING', 'VALIDATING', 'PREVIEW_READY', 'IMPORTING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "import_duplicate_policy" AS ENUM ('SKIP', 'UPDATE');

-- CreateEnum
CREATE TYPE "export_status" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'EXPIRED');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "opt_in_keywords" TEXT[] DEFAULT ARRAY['START', 'SUBSCRIBE', 'OPT IN']::TEXT[],
ADD COLUMN     "opt_out_keywords" TEXT[] DEFAULT ARRAY['STOP', 'UNSUBSCRIBE', 'CANCEL', 'STOP ALL', 'OPT OUT']::TEXT[],
ADD COLUMN     "opt_out_reply" TEXT DEFAULT 'You''re unsubscribed from marketing messages. Reply START to subscribe again.';

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "marketing_consent" "consent_state" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "owner_id" UUID,
ADD COLUMN     "utility_consent" "consent_state" NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "purpose" "consent_purpose";

-- CreateTable
CREATE TABLE "contact_property_definitions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "property_type" NOT NULL,
    "options" JSONB,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contact_property_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_property_values" (
    "tenant_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "value_text" TEXT,
    "value_number" DECIMAL(24,6),
    "value_date" DATE,
    "value_bool" BOOLEAN,

    CONSTRAINT "contact_property_values_pkey" PRIMARY KEY ("contact_id","definition_id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" CITEXT NOT NULL,
    "color" "tag_color" NOT NULL DEFAULT 'NEUTRAL',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_tags" (
    "tenant_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_tags_pkey" PRIMARY KEY ("contact_id","tag_id")
);

-- CreateTable
CREATE TABLE "contact_notes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "contact_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "channel" "consent_channel" NOT NULL DEFAULT 'WHATSAPP',
    "purpose" "consent_purpose" NOT NULL,
    "status" "consent_status" NOT NULL,
    "source" "consent_source" NOT NULL,
    "captured_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "revoke_source" "consent_source",
    "evidence" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_activities" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "actor_type" "actor_type" NOT NULL,
    "actor_id" UUID,
    "data" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "segments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "filter" JSONB NOT NULL,
    "created_by" UUID NOT NULL,
    "cached_count" INTEGER,
    "cached_count_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "status" "import_status" NOT NULL DEFAULT 'UPLOADED',
    "headers" JSONB,
    "sample" JSONB,
    "suggested_mapping" JSONB,
    "column_mapping" JSONB,
    "duplicate_policy" "import_duplicate_policy" NOT NULL DEFAULT 'SKIP',
    "default_consent" JSONB,
    "suppress_automations" BOOLEAN NOT NULL DEFAULT true,
    "preview" JSONB,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "valid_rows" INTEGER NOT NULL DEFAULT 0,
    "invalid_rows" INTEGER NOT NULL DEFAULT 0,
    "new_rows" INTEGER NOT NULL DEFAULT 0,
    "existing_rows" INTEGER NOT NULL DEFAULT 0,
    "processed_rows" INTEGER NOT NULL DEFAULT 0,
    "created_count" INTEGER NOT NULL DEFAULT 0,
    "updated_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "error_file_id" UUID,
    "failure_reason" TEXT,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_job_errors" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "import_job_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "field" TEXT,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,

    CONSTRAINT "import_job_errors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_jobs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "filter" JSONB NOT NULL,
    "status" "export_status" NOT NULL DEFAULT 'QUEUED',
    "file_id" UUID,
    "row_count" INTEGER,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contact_property_definitions_tenant_id_key_key" ON "contact_property_definitions"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "contact_property_values_tenant_id_definition_id_value_text_idx" ON "contact_property_values"("tenant_id", "definition_id", "value_text");

-- CreateIndex
CREATE INDEX "contact_property_values_tenant_id_definition_id_value_numbe_idx" ON "contact_property_values"("tenant_id", "definition_id", "value_number");

-- CreateIndex
CREATE INDEX "contact_property_values_tenant_id_definition_id_value_date_idx" ON "contact_property_values"("tenant_id", "definition_id", "value_date");

-- CreateIndex
CREATE UNIQUE INDEX "tags_tenant_id_name_key" ON "tags"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "contact_tags_tenant_id_tag_id_idx" ON "contact_tags"("tenant_id", "tag_id");

-- CreateIndex
CREATE INDEX "contact_notes_tenant_id_contact_id_created_at_idx" ON "contact_notes"("tenant_id", "contact_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "consents_tenant_id_contact_id_channel_purpose_captured_at_idx" ON "consents"("tenant_id", "contact_id", "channel", "purpose", "captured_at" DESC);

-- CreateIndex
CREATE INDEX "contact_activities_tenant_id_contact_id_occurred_at_idx" ON "contact_activities"("tenant_id", "contact_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "segments_tenant_id_created_at_idx" ON "segments"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "import_jobs_tenant_id_created_at_idx" ON "import_jobs"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "import_job_errors_import_job_id_row_number_idx" ON "import_job_errors"("import_job_id", "row_number");

-- CreateIndex
CREATE INDEX "export_jobs_tenant_id_created_at_idx" ON "export_jobs"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "contacts_tenant_id_marketing_consent_idx" ON "contacts"("tenant_id", "marketing_consent");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_property_definitions" ADD CONSTRAINT "contact_property_definitions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_property_values" ADD CONSTRAINT "contact_property_values_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_property_values" ADD CONSTRAINT "contact_property_values_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_property_values" ADD CONSTRAINT "contact_property_values_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "contact_property_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_activities" ADD CONSTRAINT "contact_activities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_activities" ADD CONSTRAINT "contact_activities_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segments" ADD CONSTRAINT "segments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_job_errors" ADD CONSTRAINT "import_job_errors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_job_errors" ADD CONSTRAINT "import_job_errors_import_job_id_fkey" FOREIGN KEY ("import_job_id") REFERENCES "import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Request access leads from the marketing site (global: no tenant yet). The row is written before
-- the email job, so a lead is never lost when email fails (docs/API_SPEC.md → Public).
-- CreateEnum
CREATE TYPE "access_request_status" AS ENUM ('QUEUED', 'EMAILED', 'EMAIL_FAILED', 'EMAIL_SKIPPED');

-- CreateTable
CREATE TABLE "access_requests" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "volume" TEXT NOT NULL,
    "status" "access_request_status" NOT NULL DEFAULT 'QUEUED',
    "email_error_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "access_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "access_requests_created_at_id_idx" ON "access_requests"("created_at" DESC, "id");

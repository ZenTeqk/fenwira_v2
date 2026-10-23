-- ADR-0027 Managed Launch Mode step 3: manual UPI billing. New tenant tables get forced RLS from
-- post-migrate.sql (fenwira_apply_tenant_policy); partial unique indexes, sequences, grants and
-- system functions are there too.
-- CreateEnum
CREATE TYPE "invoice_kind" AS ENUM ('PLAN_RENEWAL', 'WALLET_TOPUP');

-- CreateEnum
CREATE TYPE "invoice_status" AS ENUM ('OPEN', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "payment_proof_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "file_purpose" ADD VALUE 'PAYMENT_PROOF';

-- AlterEnum


ALTER TYPE "subscription_status" ADD VALUE 'PAST_DUE';
ALTER TYPE "subscription_status" ADD VALUE 'SUSPENDED';

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "kind" "invoice_kind" NOT NULL,
    "status" "invoice_status" NOT NULL DEFAULT 'OPEN',
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "subtotal_minor" BIGINT NOT NULL,
    "tax_minor" BIGINT NOT NULL DEFAULT 0,
    "total_minor" BIGINT NOT NULL,
    "tax_lines" JSONB NOT NULL DEFAULT '[]',
    "plan_id" UUID,
    "description" TEXT NOT NULL,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "payee_vpa" TEXT NOT NULL,
    "payee_name" TEXT NOT NULL,
    "gstin" TEXT,
    "created_by_type" "actor_type" NOT NULL,
    "created_by_id" UUID,
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMPTZ(3),
    "voided_at" TIMESTAMPTZ(3),
    "void_reason" TEXT,
    "commercial_operation_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_proofs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "utr" TEXT NOT NULL,
    "file_id" UUID,
    "status" "payment_proof_status" NOT NULL DEFAULT 'PENDING',
    "submitted_by_id" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "rejection_reason" TEXT,
    "receipt_number" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_proofs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");

-- CreateIndex
CREATE INDEX "invoices_tenant_id_status_due_at_idx" ON "invoices"("tenant_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "invoices_tenant_id_created_at_id_idx" ON "invoices"("tenant_id", "created_at" DESC, "id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_proofs_receipt_number_key" ON "payment_proofs"("receipt_number");

-- CreateIndex
CREATE INDEX "payment_proofs_tenant_id_invoice_id_idx" ON "payment_proofs"("tenant_id", "invoice_id");

-- CreateIndex
CREATE INDEX "payment_proofs_status_submitted_at_idx" ON "payment_proofs"("status", "submitted_at");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;


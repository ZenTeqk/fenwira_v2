-- Billing reminder emails (invoice issued, due soon, overdue, approved, rejected): each member's
-- email is claimed once by setting emailed_at, so redelivered events never send twice.
-- AlterTable
ALTER TABLE "notifications" ADD COLUMN "emailed_at" TIMESTAMPTZ(3);

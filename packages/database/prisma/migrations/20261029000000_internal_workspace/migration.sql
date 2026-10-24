-- Internal workspace flag (operator-only, set through the audited `internal_flag` commercial
-- operation). Internal workspaces get Business limits with every feature on and are exempt from
-- trial/renewal invoices, lifecycle emails, suspension and wallet charges.
ALTER TABLE "tenants" ADD COLUMN "is_internal" BOOLEAN NOT NULL DEFAULT false;

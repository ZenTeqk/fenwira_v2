-- Managed Launch: customers have no wallet (Meta bills WhatsApp charges to them directly), so every
-- existing workspace uses wallet mode FREE; new workspaces are created FREE by the API while
-- MANAGED_LAUNCH_MODE is on. Nothing is deleted: balances, ledger rows and reservations stay.
-- The table owner is subject to FORCE ROW LEVEL SECURITY, so lift it for this one statement;
-- it is restored here and again by post-migrate.sql.
ALTER TABLE "tenants" NO FORCE ROW LEVEL SECURITY;
UPDATE "tenants" SET "billing_mode" = 'FREE' WHERE "billing_mode" <> 'FREE';
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;

-- The price book is not approved commercial pricing. Startup refuses BILLING_ENFORCED=true while
-- any active entry is still a placeholder (docs/BILLING.md → Price book). Entries are kept.
UPDATE "price_book_entries"
SET "is_placeholder" = true,
    "note" = 'Unapproved: not commercial pricing. Approve real prices before enabling BILLING_ENFORCED.'
WHERE "is_placeholder" = false;

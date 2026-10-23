-- ADR-0027 Managed Launch Mode step 2: operator-managed Meta connections. Columns only on existing
-- tenant tables (RLS policies unchanged and still forced).
CREATE TYPE "connection_mode" AS ENUM ('EMBEDDED_SIGNUP', 'MANAGED');

ALTER TABLE "whatsapp_business_accounts"
  ADD COLUMN "connection_mode" "connection_mode" NOT NULL DEFAULT 'EMBEDDED_SIGNUP',
  ADD COLUMN "meta_app_id" TEXT,
  ADD COLUMN "app_secret_ciphertext" BYTEA,
  ADD COLUMN "app_secret_last4" TEXT,
  ADD COLUMN "app_secret_rotated_at" TIMESTAMPTZ(3);

ALTER TABLE "meta_credentials"
  ADD COLUMN "verified_at" TIMESTAMPTZ(3),
  ADD COLUMN "verify_ok" BOOLEAN,
  ADD COLUMN "verify_error_code" TEXT,
  ADD COLUMN "verify_error" TEXT;

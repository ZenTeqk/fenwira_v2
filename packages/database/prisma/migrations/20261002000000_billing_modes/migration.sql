-- CreateEnum
CREATE TYPE "billing_mode" AS ENUM ('FREE', 'TRIAL', 'PREPAID');

-- AlterEnum
ALTER TYPE "campaign_status" ADD VALUE 'PAUSED_TEMPLATE_UNAVAILABLE';

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "billing_mode" "billing_mode" NOT NULL DEFAULT 'TRIAL';

-- AlterTable
ALTER TABLE "usage_events" ADD COLUMN     "provider_cost_minor" BIGINT;

-- AlterTable (P9-D2): the charge keeps its values; provider cost and tax metadata are new.
ALTER TABLE "price_book_entries" RENAME COLUMN "unit_price_minor" TO "customer_price_minor";
ALTER TABLE "price_book_entries"
ADD COLUMN     "is_placeholder" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "provider_cost_minor" BIGINT,
ADD COLUMN     "tax_bps" INTEGER,
ADD COLUMN     "tax_code" TEXT;
UPDATE "price_book_entries"
SET "is_placeholder" = true, "note" = 'Development placeholder, not commercial pricing (P9-D2).';

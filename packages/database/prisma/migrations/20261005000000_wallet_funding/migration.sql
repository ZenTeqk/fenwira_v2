-- P11-D21: distinguish a wallet's initial funding from a recovery.
ALTER TABLE "wallets" ADD COLUMN     "funded_at" TIMESTAMPTZ(3);

-- Wallets that already had a credit were funded then.
UPDATE "wallets" w SET "funded_at" = f.first_credit
FROM (
  SELECT "wallet_id", min("created_at") AS first_credit
  FROM "wallet_transactions" WHERE "amount_minor" > 0 GROUP BY "wallet_id"
) f
WHERE f."wallet_id" = w."id";

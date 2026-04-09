CREATE TYPE "PaymentPayoutTarget" AS ENUM ('platform', 'organizer');

ALTER TABLE "Payment"
ADD COLUMN "payoutTarget" "PaymentPayoutTarget";

UPDATE "Payment"
SET "payoutTarget" = CASE
  WHEN "destinationAccountId" IS NOT NULL THEN 'organizer'::"PaymentPayoutTarget"
  ELSE 'platform'::"PaymentPayoutTarget"
END
WHERE "payoutTarget" IS NULL;

ALTER TABLE "Payment"
ALTER COLUMN "payoutTarget" SET DEFAULT 'platform'::"PaymentPayoutTarget",
ALTER COLUMN "payoutTarget" SET NOT NULL;

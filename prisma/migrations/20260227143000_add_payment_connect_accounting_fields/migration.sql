-- Stripe Connect destination-charge accounting fields on payments
ALTER TABLE "Payment"
ADD COLUMN "destinationAccountId" TEXT,
ADD COLUMN "transferGroup" TEXT,
ADD COLUMN "applicationFeeAmount" INTEGER,
ADD COLUMN "stripeChargeId" TEXT,
ADD COLUMN "stripeBalanceTransactionId" TEXT,
ADD COLUMN "stripeTransferId" TEXT,
ADD COLUMN "stripeApplicationFeeId" TEXT;

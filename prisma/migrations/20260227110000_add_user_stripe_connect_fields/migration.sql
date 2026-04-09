-- Stripe Connect onboarding/account status per organizer
ALTER TABLE "User"
ADD COLUMN "stripeConnectAccountId" TEXT,
ADD COLUMN "stripeConnectChargesEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "stripeConnectPayoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "stripeConnectDetailsSubmitted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "stripeConnectOnboardingCompletedAt" TIMESTAMP(3),
ADD COLUMN "stripeConnectStatusUpdatedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "User_stripeConnectAccountId_key" ON "User"("stripeConnectAccountId");

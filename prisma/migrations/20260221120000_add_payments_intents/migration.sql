-- Alter Event for paid events
ALTER TABLE "Event"
ADD COLUMN "isPaid" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "priceCents" INTEGER,
ADD COLUMN "currency" VARCHAR(3);

-- Payment status enum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'succeeded', 'failed');

-- Payment table
CREATE TABLE "Payment" (
  "id" TEXT NOT NULL,
  "stripePaymentIntentId" TEXT NOT NULL,
  "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
  "amountCents" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "eventId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "rsvpId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Payment_stripePaymentIntentId_key" ON "Payment"("stripePaymentIntentId");
CREATE INDEX "Payment_eventId_idx" ON "Payment"("eventId");
CREATE INDEX "Payment_userId_idx" ON "Payment"("userId");

ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("clerkId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_rsvpId_fkey" FOREIGN KEY ("rsvpId") REFERENCES "RSVP"("id") ON DELETE SET NULL ON UPDATE CASCADE;

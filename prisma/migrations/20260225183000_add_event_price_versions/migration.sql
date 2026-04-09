-- Add canceled state to payment lifecycle
ALTER TYPE "PaymentStatus" ADD VALUE 'canceled';

-- Add versioning pointers (backward-compatible: nullable during rollout)
ALTER TABLE "Event"
ADD COLUMN "currentPriceVersionId" TEXT;

ALTER TABLE "Payment"
ADD COLUMN "priceVersionId" TEXT;

-- Event price version history table (DB source of truth for pricing)
CREATE TABLE "EventPriceVersion" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "isPaid" BOOLEAN NOT NULL,
  "amountCents" INTEGER,
  "currency" VARCHAR(3),
  "createdBy" TEXT,
  "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "supersededAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventPriceVersion_pkey" PRIMARY KEY ("id")
);

-- Unique current-price pointer per event (nullable until backfill/rollout)
CREATE UNIQUE INDEX "Event_currentPriceVersionId_key" ON "Event"("currentPriceVersionId");

-- EventPriceVersion constraints / indexes
CREATE UNIQUE INDEX "EventPriceVersion_eventId_versionNumber_key" ON "EventPriceVersion"("eventId", "versionNumber");
CREATE INDEX "EventPriceVersion_eventId_createdAt_idx" ON "EventPriceVersion"("eventId", "createdAt");
CREATE INDEX "EventPriceVersion_eventId_effectiveAt_idx" ON "EventPriceVersion"("eventId", "effectiveAt");

-- Payment indexes for version-aware checkout/restriction lookups
CREATE INDEX "Payment_priceVersionId_idx" ON "Payment"("priceVersionId");
CREATE INDEX "Payment_eventId_status_idx" ON "Payment"("eventId", "status");
CREATE INDEX "Payment_eventId_userId_status_idx" ON "Payment"("eventId", "userId", "status");

-- Foreign keys (added after table creation to handle cyclical event<->price version refs)
ALTER TABLE "EventPriceVersion"
ADD CONSTRAINT "EventPriceVersion_eventId_fkey"
FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Event"
ADD CONSTRAINT "Event_currentPriceVersionId_fkey"
FOREIGN KEY ("currentPriceVersionId") REFERENCES "EventPriceVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_priceVersionId_fkey"
FOREIGN KEY ("priceVersionId") REFERENCES "EventPriceVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

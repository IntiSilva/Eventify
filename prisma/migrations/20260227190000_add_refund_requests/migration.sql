CREATE TYPE "RefundRequestStatus" AS ENUM ('requested', 'approved', 'rejected', 'processing', 'succeeded', 'failed', 'canceled');

CREATE TABLE "RefundRequest" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "reason" VARCHAR(500),
    "status" "RefundRequestStatus" NOT NULL DEFAULT 'requested',
    "stripeRefundId" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefundRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RefundRequest_paymentId_key" ON "RefundRequest"("paymentId");
CREATE UNIQUE INDEX "RefundRequest_stripeRefundId_key" ON "RefundRequest"("stripeRefundId");
CREATE INDEX "RefundRequest_requestedByUserId_idx" ON "RefundRequest"("requestedByUserId");
CREATE INDEX "RefundRequest_status_idx" ON "RefundRequest"("status");

ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

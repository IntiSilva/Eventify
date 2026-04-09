ALTER TABLE "RefundRequest"
ADD COLUMN "refundEmailSentAt" TIMESTAMP(3),
ADD COLUMN "refundReference" VARCHAR(64),
ADD COLUMN "refundReferenceType" VARCHAR(64),
ADD COLUMN "refundReferenceStatus" VARCHAR(32),
ADD COLUMN "refundSucceededAt" TIMESTAMP(3);

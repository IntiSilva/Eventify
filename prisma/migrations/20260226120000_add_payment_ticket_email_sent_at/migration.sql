-- Track whether purchase confirmation email has been sent for this payment
ALTER TABLE "Payment"
ADD COLUMN "ticketEmailSentAt" TIMESTAMP(3);

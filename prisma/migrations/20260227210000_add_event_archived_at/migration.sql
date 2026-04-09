ALTER TABLE "Event" ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "Event_archivedAt_idx" ON "Event"("archivedAt");

-- Speeds up cron query: due reminders that haven't been sent yet
CREATE INDEX IF NOT EXISTS "RSVP_reminders_due_idx"
ON "RSVP" ("reminderScheduledAt")
WHERE
  "reminderSentAt" IS NULL
  AND "status" = 'confirmed'
  AND "reminderScheduledAt" IS NOT NULL;

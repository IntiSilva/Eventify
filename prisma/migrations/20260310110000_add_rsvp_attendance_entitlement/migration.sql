CREATE TYPE "RSVPAttendanceEntitlementStatus" AS ENUM ('active', 'refund_pending_hold', 'revoked_refunded');

ALTER TABLE "RSVP"
ADD COLUMN "attendanceEntitlementStatus" "RSVPAttendanceEntitlementStatus" NOT NULL DEFAULT 'active';

import {
  RSVPAttendanceEntitlementStatus,
  RSVPStatus,
} from '@/generated/prisma';
import type { Prisma } from '@/generated/prisma';

type AttendanceAwareRsvpLike = {
  status: RSVPStatus;
  attendanceEntitlementStatus?: RSVPAttendanceEntitlementStatus | null;
};

// Backward-compatible: payloads that still omit entitlement are treated as active.
export function hasActiveAttendanceEntitlement(
  entitlement: RSVPAttendanceEntitlementStatus | null | undefined,
): boolean {
  return (
    entitlement == null ||
    entitlement === RSVPAttendanceEntitlementStatus.active
  );
}

export function isCurrentlyAttendingRsvp(
  rsvp: AttendanceAwareRsvpLike,
): boolean {
  return (
    rsvp.status === RSVPStatus.confirmed &&
    hasActiveAttendanceEntitlement(rsvp.attendanceEntitlementStatus)
  );
}

export function filterCurrentlyAttendingRsvps<
  TRsvp extends AttendanceAwareRsvpLike,
>(rsvps: readonly TRsvp[]): TRsvp[] {
  return rsvps.filter(isCurrentlyAttendingRsvp);
}

export const CURRENTLY_ATTENDING_RSVP_WHERE = {
  status: RSVPStatus.confirmed,
  attendanceEntitlementStatus: RSVPAttendanceEntitlementStatus.active,
} as const satisfies Prisma.RSVPWhereInput;

import 'server-only';

import {
  RefundRequestStatus,
  RSVPAttendanceEntitlementStatus,
} from '@/generated/prisma';
import { prisma } from '@/lib/prisma';
import { mapRefundStatusToAttendanceEntitlement } from '@/lib/payments/rsvpEntitlementCore';

export type RsvpEntitlementUpdateResult =
  | {
      kind: 'updated';
      paymentId: string;
      rsvpId: string;
      targetEntitlement: RSVPAttendanceEntitlementStatus;
      previousEntitlement: RSVPAttendanceEntitlementStatus;
      lookup: 'payment_rsvp_id' | 'user_event_fallback';
    }
  | {
      kind: 'noop_already_target';
      paymentId: string;
      rsvpId: string;
      targetEntitlement: RSVPAttendanceEntitlementStatus;
      lookup: 'payment_rsvp_id' | 'user_event_fallback';
    }
  | {
      kind: 'noop_missing_rsvp';
      paymentId: string;
      targetEntitlement: RSVPAttendanceEntitlementStatus;
    }
  | {
      kind: 'noop_missing_payment';
      paymentId: string;
      targetEntitlement: RSVPAttendanceEntitlementStatus;
    };

export {
  evaluateIsFullRefund,
  mapRefundStatusToAttendanceEntitlement,
} from '@/lib/payments/rsvpEntitlementCore';

export async function syncRsvpAttendanceEntitlementFromRefundStatus(input: {
  paymentId: string;
  refundStatus: RefundRequestStatus;
  isFullRefund?: boolean | null;
}): Promise<RsvpEntitlementUpdateResult> {
  const targetEntitlement = mapRefundStatusToAttendanceEntitlement({
    refundStatus: input.refundStatus,
    isFullRefund: input.isFullRefund,
  });

  const payment = await prisma.payment.findUnique({
    where: { id: input.paymentId },
    select: {
      id: true,
      rsvpId: true,
      userId: true,
      eventId: true,
      rsvp: {
        select: {
          id: true,
          attendanceEntitlementStatus: true,
        },
      },
    },
  });

  if (!payment) {
    return {
      kind: 'noop_missing_payment',
      paymentId: input.paymentId,
      targetEntitlement,
    };
  }

  let rsvpId: string | null = payment.rsvp?.id ?? null;
  let currentEntitlement: RSVPAttendanceEntitlementStatus | null =
    payment.rsvp?.attendanceEntitlementStatus ?? null;
  let lookup: 'payment_rsvp_id' | 'user_event_fallback' = 'payment_rsvp_id';

  if (!rsvpId) {
    const fallbackRsvp = await prisma.rSVP.findUnique({
      where: {
        userId_eventId: {
          userId: payment.userId,
          eventId: payment.eventId,
        },
      },
      select: {
        id: true,
        attendanceEntitlementStatus: true,
      },
    });

    if (!fallbackRsvp) {
      return {
        kind: 'noop_missing_rsvp',
        paymentId: input.paymentId,
        targetEntitlement,
      };
    }

    rsvpId = fallbackRsvp.id;
    currentEntitlement = fallbackRsvp.attendanceEntitlementStatus;
    lookup = 'user_event_fallback';
  }

  if (!rsvpId || !currentEntitlement) {
    return {
      kind: 'noop_missing_rsvp',
      paymentId: input.paymentId,
      targetEntitlement,
    };
  }

  if (currentEntitlement === targetEntitlement) {
    return {
      kind: 'noop_already_target',
      paymentId: input.paymentId,
      rsvpId,
      targetEntitlement,
      lookup,
    };
  }

  await prisma.rSVP.update({
    where: { id: rsvpId },
    data: {
      attendanceEntitlementStatus: targetEntitlement,
    },
  });

  return {
    kind: 'updated',
    paymentId: input.paymentId,
    rsvpId,
    targetEntitlement,
    previousEntitlement: currentEntitlement,
    lookup,
  };
}

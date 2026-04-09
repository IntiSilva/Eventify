import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RefundRequestStatus,
  RSVPAttendanceEntitlementStatus,
} from '@/generated/prisma';

const h = vi.hoisted(() => ({
  prisma: {
    payment: {
      findUnique: vi.fn(),
    },
    rSVP: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: h.prisma,
}));

import {
  evaluateIsFullRefund,
  mapRefundStatusToAttendanceEntitlement,
  syncRsvpAttendanceEntitlementFromRefundStatus,
} from '@/lib/payments/rsvpEntitlement';

describe('payments/rsvpEntitlement mapping', () => {
  it('maps requested/approved/processing to refund_pending_hold', () => {
    expect(
      mapRefundStatusToAttendanceEntitlement({
        refundStatus: RefundRequestStatus.requested,
      })
    ).toBe(RSVPAttendanceEntitlementStatus.refund_pending_hold);
    expect(
      mapRefundStatusToAttendanceEntitlement({
        refundStatus: RefundRequestStatus.approved,
      })
    ).toBe(RSVPAttendanceEntitlementStatus.refund_pending_hold);
    expect(
      mapRefundStatusToAttendanceEntitlement({
        refundStatus: RefundRequestStatus.processing,
      })
    ).toBe(RSVPAttendanceEntitlementStatus.refund_pending_hold);
  });

  it('only revokes succeeded refunds when full refund is true', () => {
    expect(
      mapRefundStatusToAttendanceEntitlement({
        refundStatus: RefundRequestStatus.succeeded,
        isFullRefund: true,
      })
    ).toBe(RSVPAttendanceEntitlementStatus.revoked_refunded);
    expect(
      mapRefundStatusToAttendanceEntitlement({
        refundStatus: RefundRequestStatus.succeeded,
        isFullRefund: false,
      })
    ).toBe(RSVPAttendanceEntitlementStatus.active);
  });

  it('maps failed/rejected/canceled to active', () => {
    expect(
      mapRefundStatusToAttendanceEntitlement({
        refundStatus: RefundRequestStatus.failed,
      })
    ).toBe(RSVPAttendanceEntitlementStatus.active);
    expect(
      mapRefundStatusToAttendanceEntitlement({
        refundStatus: RefundRequestStatus.rejected,
      })
    ).toBe(RSVPAttendanceEntitlementStatus.active);
    expect(
      mapRefundStatusToAttendanceEntitlement({
        refundStatus: RefundRequestStatus.canceled,
      })
    ).toBe(RSVPAttendanceEntitlementStatus.active);
  });

  it('evaluates full refund from cents comparison', () => {
    expect(
      evaluateIsFullRefund({
        refundAmountCents: 2000,
        paymentAmountCents: 2000,
      })
    ).toBe(true);
    expect(
      evaluateIsFullRefund({
        refundAmountCents: 1500,
        paymentAmountCents: 2000,
      })
    ).toBe(false);
  });
});

describe('payments/rsvpEntitlement syncRsvpAttendanceEntitlementFromRefundStatus', () => {
  beforeEach(() => {
    h.prisma.payment.findUnique.mockReset();
    h.prisma.rSVP.findUnique.mockReset();
    h.prisma.rSVP.update.mockReset();
  });

  it('updates RSVP when linked payment.rsvpId exists and target differs', async () => {
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_1',
      rsvpId: 'rsvp_1',
      userId: 'user_1',
      eventId: 'evt_1',
      rsvp: {
        id: 'rsvp_1',
        attendanceEntitlementStatus: RSVPAttendanceEntitlementStatus.active,
      },
    });
    h.prisma.rSVP.update.mockResolvedValue({});

    const result = await syncRsvpAttendanceEntitlementFromRefundStatus({
      paymentId: 'pay_1',
      refundStatus: RefundRequestStatus.processing,
    });

    expect(h.prisma.rSVP.update).toHaveBeenCalledWith({
      where: { id: 'rsvp_1' },
      data: {
        attendanceEntitlementStatus:
          RSVPAttendanceEntitlementStatus.refund_pending_hold,
      },
    });
    expect(result).toEqual({
      kind: 'updated',
      paymentId: 'pay_1',
      rsvpId: 'rsvp_1',
      targetEntitlement: RSVPAttendanceEntitlementStatus.refund_pending_hold,
      previousEntitlement: RSVPAttendanceEntitlementStatus.active,
      lookup: 'payment_rsvp_id',
    });
  });

  it('is idempotent when RSVP already matches target entitlement', async () => {
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_1',
      rsvpId: 'rsvp_1',
      userId: 'user_1',
      eventId: 'evt_1',
      rsvp: {
        id: 'rsvp_1',
        attendanceEntitlementStatus:
          RSVPAttendanceEntitlementStatus.refund_pending_hold,
      },
    });

    const result = await syncRsvpAttendanceEntitlementFromRefundStatus({
      paymentId: 'pay_1',
      refundStatus: RefundRequestStatus.processing,
    });

    expect(h.prisma.rSVP.update).not.toHaveBeenCalled();
    expect(result).toEqual({
      kind: 'noop_already_target',
      paymentId: 'pay_1',
      rsvpId: 'rsvp_1',
      targetEntitlement: RSVPAttendanceEntitlementStatus.refund_pending_hold,
      lookup: 'payment_rsvp_id',
    });
  });

  it('falls back to user+event RSVP when payment.rsvpId is missing', async () => {
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_2',
      rsvpId: null,
      userId: 'user_2',
      eventId: 'evt_2',
      rsvp: null,
    });
    h.prisma.rSVP.findUnique.mockResolvedValue({
      id: 'rsvp_fallback',
      attendanceEntitlementStatus: RSVPAttendanceEntitlementStatus.active,
    });
    h.prisma.rSVP.update.mockResolvedValue({});

    const result = await syncRsvpAttendanceEntitlementFromRefundStatus({
      paymentId: 'pay_2',
      refundStatus: RefundRequestStatus.succeeded,
      isFullRefund: true,
    });

    expect(h.prisma.rSVP.findUnique).toHaveBeenCalledWith({
      where: {
        userId_eventId: {
          userId: 'user_2',
          eventId: 'evt_2',
        },
      },
      select: {
        id: true,
        attendanceEntitlementStatus: true,
      },
    });
    expect(result).toEqual({
      kind: 'updated',
      paymentId: 'pay_2',
      rsvpId: 'rsvp_fallback',
      targetEntitlement: RSVPAttendanceEntitlementStatus.revoked_refunded,
      previousEntitlement: RSVPAttendanceEntitlementStatus.active,
      lookup: 'user_event_fallback',
    });
  });

  it('returns noop_missing_rsvp when no RSVP can be located', async () => {
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_3',
      rsvpId: null,
      userId: 'user_3',
      eventId: 'evt_3',
      rsvp: null,
    });
    h.prisma.rSVP.findUnique.mockResolvedValue(null);

    const result = await syncRsvpAttendanceEntitlementFromRefundStatus({
      paymentId: 'pay_3',
      refundStatus: RefundRequestStatus.processing,
    });

    expect(h.prisma.rSVP.update).not.toHaveBeenCalled();
    expect(result).toEqual({
      kind: 'noop_missing_rsvp',
      paymentId: 'pay_3',
      targetEntitlement: RSVPAttendanceEntitlementStatus.refund_pending_hold,
    });
  });
});

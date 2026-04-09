import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RefundRequestStatus } from '@/generated/prisma';

const h = vi.hoisted(() => ({
  stripe: {
    refunds: {
      retrieve: vi.fn(),
    },
  },
  prisma: {
    refundRequest: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
  sendRefundConfirmationEmailIfNeeded: vi.fn(),
  syncRsvpAttendanceEntitlementFromRefundStatus: vi.fn(),
  evaluateIsFullRefund: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: h.prisma,
}));
vi.mock('@/lib/stripe', () => ({
  stripe: h.stripe,
}));
vi.mock('@/lib/payments/refundEmail', () => ({
  sendRefundConfirmationEmailIfNeeded: h.sendRefundConfirmationEmailIfNeeded,
}));
vi.mock('@/lib/payments/rsvpEntitlement', () => ({
  syncRsvpAttendanceEntitlementFromRefundStatus:
    h.syncRsvpAttendanceEntitlementFromRefundStatus,
  evaluateIsFullRefund: h.evaluateIsFullRefund,
}));

import { syncRefundRequestFromStripeRefund } from '@/lib/payments/refunds';

describe('payments/refunds.syncRefundRequestFromStripeRefund', () => {
  beforeEach(() => {
    h.stripe.refunds.retrieve.mockReset();
    h.prisma.refundRequest.updateMany.mockReset();
    h.prisma.refundRequest.findUnique.mockReset();
    h.sendRefundConfirmationEmailIfNeeded.mockReset();
    h.syncRsvpAttendanceEntitlementFromRefundStatus.mockReset();
    h.evaluateIsFullRefund.mockReset();
    h.stripe.refunds.retrieve.mockResolvedValue({
      id: 're_1',
      status: 'succeeded',
      amount: 5000,
      destination_details: {
        type: 'card',
        card: {
          reference: '6990533368941588',
          reference_status: 'available',
          reference_type: 'arn',
          type: 'refund',
        },
      },
    });
    h.prisma.refundRequest.updateMany.mockResolvedValue({ count: 1 });
    h.prisma.refundRequest.findUnique.mockResolvedValue({
      id: 'rr_1',
      paymentId: 'pay_1',
      payment: { amountCents: 5000 },
    });
    h.syncRsvpAttendanceEntitlementFromRefundStatus.mockResolvedValue({
      kind: 'noop_already_target',
      paymentId: 'pay_1',
      rsvpId: 'rsvp_1',
      targetEntitlement: 'revoked_refunded',
      lookup: 'payment_rsvp_id',
    });
    h.evaluateIsFullRefund.mockReturnValue(true);
    h.sendRefundConfirmationEmailIfNeeded.mockResolvedValue({ sent: true });
  });

  it('updates the refund request and sends email when the refund succeeded', async () => {
    await syncRefundRequestFromStripeRefund({
      id: 're_1',
      status: 'succeeded',
    } as never);

    expect(h.prisma.refundRequest.updateMany).toHaveBeenCalledWith({
      where: { stripeRefundId: 're_1' },
      data: expect.objectContaining({
        status: RefundRequestStatus.succeeded,
        refundReference: '6990533368941588',
        refundReferenceType: 'arn',
        refundReferenceStatus: 'available',
        refundSucceededAt: expect.any(Date),
      }),
    });
    expect(h.syncRsvpAttendanceEntitlementFromRefundStatus).toHaveBeenCalledWith({
      paymentId: 'pay_1',
      refundStatus: RefundRequestStatus.succeeded,
      isFullRefund: true,
    });
    expect(h.sendRefundConfirmationEmailIfNeeded).toHaveBeenCalledWith('rr_1');
  });

  it('does not send email when the refund is still processing', async () => {
    h.stripe.refunds.retrieve.mockResolvedValue({
      id: 're_1',
      status: 'pending',
      amount: 2000,
      destination_details: {
        type: 'card',
        card: {
          reference: null,
          reference_status: 'pending',
          reference_type: 'arn',
          type: 'pending',
        },
      },
    });

    await syncRefundRequestFromStripeRefund({
      id: 're_1',
      status: 'pending',
    } as never);

    expect(h.prisma.refundRequest.updateMany).toHaveBeenCalledWith({
      where: { stripeRefundId: 're_1' },
      data: {
        status: RefundRequestStatus.processing,
        refundReference: null,
        refundReferenceType: 'arn',
        refundReferenceStatus: 'pending',
      },
    });
    expect(h.prisma.refundRequest.findUnique).toHaveBeenCalledWith({
      where: { stripeRefundId: 're_1' },
      select: {
        id: true,
        paymentId: true,
        payment: {
          select: {
            amountCents: true,
          },
        },
      },
    });
    expect(h.syncRsvpAttendanceEntitlementFromRefundStatus).toHaveBeenCalledWith({
      paymentId: 'pay_1',
      refundStatus: RefundRequestStatus.processing,
      isFullRefund: true,
    });
    expect(h.sendRefundConfirmationEmailIfNeeded).not.toHaveBeenCalled();
  });

  it('keeps entitlement active for succeeded partial refunds', async () => {
    h.stripe.refunds.retrieve.mockResolvedValue({
      id: 're_1',
      status: 'succeeded',
      amount: 1200,
      destination_details: {
        type: 'card',
        card: {
          reference: '6990533368941588',
          reference_status: 'available',
          reference_type: 'arn',
          type: 'refund',
        },
      },
    });
    h.evaluateIsFullRefund.mockReturnValue(false);

    await syncRefundRequestFromStripeRefund({
      id: 're_1',
      status: 'succeeded',
    } as never);

    expect(h.syncRsvpAttendanceEntitlementFromRefundStatus).toHaveBeenCalledWith({
      paymentId: 'pay_1',
      refundStatus: RefundRequestStatus.succeeded,
      isFullRefund: false,
    });
  });

  it('maps canceled refunds back to active entitlement', async () => {
    h.stripe.refunds.retrieve.mockResolvedValue({
      id: 're_1',
      status: 'canceled',
      amount: 0,
      destination_details: {
        type: 'card',
        card: {
          reference: null,
          reference_status: 'canceled',
          reference_type: 'arn',
          type: 'refund',
        },
      },
    });

    await syncRefundRequestFromStripeRefund({
      id: 're_1',
      status: 'canceled',
    } as never);

    expect(h.syncRsvpAttendanceEntitlementFromRefundStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: 'pay_1',
        refundStatus: RefundRequestStatus.canceled,
      })
    );
    expect(h.sendRefundConfirmationEmailIfNeeded).not.toHaveBeenCalled();
  });

  it('handles repeated webhook deliveries idempotently', async () => {
    h.syncRsvpAttendanceEntitlementFromRefundStatus
      .mockResolvedValueOnce({
        kind: 'updated',
        paymentId: 'pay_1',
        rsvpId: 'rsvp_1',
        targetEntitlement: 'revoked_refunded',
        previousEntitlement: 'active',
        lookup: 'payment_rsvp_id',
      })
      .mockResolvedValueOnce({
        kind: 'noop_already_target',
        paymentId: 'pay_1',
        rsvpId: 'rsvp_1',
        targetEntitlement: 'revoked_refunded',
        lookup: 'payment_rsvp_id',
      });

    await syncRefundRequestFromStripeRefund({
      id: 're_1',
      status: 'succeeded',
    } as never);
    await syncRefundRequestFromStripeRefund({
      id: 're_1',
      status: 'succeeded',
    } as never);

    expect(h.syncRsvpAttendanceEntitlementFromRefundStatus).toHaveBeenCalledTimes(2);
    expect(h.sendRefundConfirmationEmailIfNeeded).toHaveBeenCalledTimes(2);
  });

  it('returns without sending when no refund request exists for stripeRefundId', async () => {
    h.prisma.refundRequest.updateMany.mockResolvedValue({ count: 0 });

    await syncRefundRequestFromStripeRefund({
      id: 're_1',
      status: 'succeeded',
    } as never);

    expect(h.prisma.refundRequest.findUnique).not.toHaveBeenCalled();
    expect(h.sendRefundConfirmationEmailIfNeeded).not.toHaveBeenCalled();
  });

  it('throws when the refund email helper fails so the webhook can retry', async () => {
    h.sendRefundConfirmationEmailIfNeeded.mockRejectedValue(new Error('Brevo down'));

    await expect(
      syncRefundRequestFromStripeRefund({
        id: 're_1',
        status: 'succeeded',
      } as never)
    ).rejects.toThrow('Brevo down');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PaymentPayoutTarget,
  PaymentStatus,
  RefundRequestSource,
  RefundRequestStatus,
} from '@/generated/prisma';

const h = vi.hoisted(() => ({
  prisma: {
    payment: {
      findUnique: vi.fn(),
    },
    refundRequest: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
  stripe: {
    paymentIntents: {
      retrieve: vi.fn(),
    },
    refunds: {
      create: vi.fn(),
    },
  },
  mapStripeRefundStatusToRefundRequestStatus: vi.fn(),
  syncRefundRequestFromStripeRefund: vi.fn(),
  syncRsvpAttendanceEntitlementFromRefundStatus: vi.fn(),
  evaluateIsFullRefund: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }));
vi.mock('@/lib/stripe', () => ({ stripe: h.stripe }));
vi.mock('@/lib/payments/refunds', () => ({
  mapStripeRefundStatusToRefundRequestStatus: h.mapStripeRefundStatusToRefundRequestStatus,
  syncRefundRequestFromStripeRefund: h.syncRefundRequestFromStripeRefund,
}));
vi.mock('@/lib/payments/rsvpEntitlement', () => ({
  syncRsvpAttendanceEntitlementFromRefundStatus:
    h.syncRsvpAttendanceEntitlementFromRefundStatus,
  evaluateIsFullRefund: h.evaluateIsFullRefund,
}));

import { initiateLateJoinabilityCompensation } from '@/lib/payments/lateJoinabilityCompensation';

describe('initiateLateJoinabilityCompensation', () => {
  beforeEach(() => {
    h.prisma.payment.findUnique.mockReset();
    h.prisma.refundRequest.create.mockReset();
    h.prisma.refundRequest.update.mockReset();
    h.prisma.refundRequest.updateMany.mockReset();
    h.prisma.refundRequest.findUnique.mockReset();
    h.stripe.paymentIntents.retrieve.mockReset();
    h.stripe.refunds.create.mockReset();
    h.mapStripeRefundStatusToRefundRequestStatus.mockReset();
    h.syncRefundRequestFromStripeRefund.mockReset();
    h.syncRsvpAttendanceEntitlementFromRefundStatus.mockReset();
    h.evaluateIsFullRefund.mockReset();

    h.mapStripeRefundStatusToRefundRequestStatus.mockImplementation((status: string) => {
      if (status === 'succeeded') return RefundRequestStatus.succeeded;
      if (status === 'failed') return RefundRequestStatus.failed;
      if (status === 'canceled') return RefundRequestStatus.canceled;
      return RefundRequestStatus.processing;
    });
    h.syncRefundRequestFromStripeRefund.mockResolvedValue(undefined);
    h.syncRsvpAttendanceEntitlementFromRefundStatus.mockResolvedValue({
      kind: 'noop_missing_rsvp',
      paymentId: 'pay_1',
      targetEntitlement: 'refund_pending_hold',
    });
    h.evaluateIsFullRefund.mockReturnValue(true);
  });

  it('creates compensation request and initiates organizer-mode refund', async () => {
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_1',
      userId: 'user_1',
      status: PaymentStatus.succeeded,
      amountCents: 5000,
      stripeChargeId: null,
      stripePaymentIntentId: 'pi_1',
      payoutTarget: PaymentPayoutTarget.organizer,
      refundRequest: null,
    });
    h.prisma.refundRequest.create.mockResolvedValue({ id: 'rr_1' });
    h.stripe.paymentIntents.retrieve.mockResolvedValue({
      id: 'pi_1',
      latest_charge: { id: 'ch_1' },
    });
    h.stripe.refunds.create.mockResolvedValue({
      id: 're_1',
      status: 'pending',
    });
    h.prisma.refundRequest.update.mockResolvedValue({});

    const result = await initiateLateJoinabilityCompensation('pay_1');

    expect(result).toEqual({
      status: 'refund-processing',
      refundRequestId: 'rr_1',
      stripeRefundId: 're_1',
    });
    expect(h.prisma.refundRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paymentId: 'pay_1',
          requestedByUserId: 'user_1',
          source: RefundRequestSource.SYSTEM_COMPENSATION,
          status: RefundRequestStatus.processing,
          attemptCount: 1,
        }),
      })
    );
    expect(h.stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({
        charge: 'ch_1',
        reason: 'requested_by_customer',
        reverse_transfer: true,
        refund_application_fee: true,
      }),
      expect.objectContaining({
        idempotencyKey: 'late-joinability:pay_1',
      })
    );
  });

  it('is idempotent on retry when refund was already initiated', async () => {
    h.prisma.payment.findUnique
      .mockResolvedValueOnce({
        id: 'pay_1',
        userId: 'user_1',
        status: PaymentStatus.succeeded,
        amountCents: 5000,
        stripeChargeId: 'ch_1',
        stripePaymentIntentId: 'pi_1',
        payoutTarget: PaymentPayoutTarget.organizer,
        refundRequest: null,
      })
      .mockResolvedValueOnce({
        id: 'pay_1',
        userId: 'user_1',
        status: PaymentStatus.succeeded,
        amountCents: 5000,
        stripeChargeId: 'ch_1',
        stripePaymentIntentId: 'pi_1',
        payoutTarget: PaymentPayoutTarget.organizer,
        refundRequest: {
          id: 'rr_1',
          status: RefundRequestStatus.processing,
          stripeRefundId: 're_1',
          reason: 'Automatic refund',
        },
      });

    h.prisma.refundRequest.create.mockResolvedValue({ id: 'rr_1' });
    h.stripe.refunds.create.mockResolvedValue({
      id: 're_1',
      status: 'pending',
    });
    h.prisma.refundRequest.update.mockResolvedValue({});

    const first = await initiateLateJoinabilityCompensation('pay_1');
    const second = await initiateLateJoinabilityCompensation('pay_1');

    expect(first.status).toBe('refund-processing');
    expect(second).toEqual({
      status: 'already-handled',
      refundRequestId: 'rr_1',
      stripeRefundId: 're_1',
    });
    expect(h.stripe.refunds.create).toHaveBeenCalledTimes(1);
  });

  it('claims an existing refund request and stamps compensation source before creating refund', async () => {
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_1',
      userId: 'user_1',
      status: PaymentStatus.succeeded,
      amountCents: 5000,
      stripeChargeId: 'ch_1',
      stripePaymentIntentId: 'pi_1',
      payoutTarget: PaymentPayoutTarget.platform,
      refundRequest: {
        id: 'rr_existing',
        status: RefundRequestStatus.failed,
        stripeRefundId: null,
        reason: null,
      },
    });
    h.prisma.refundRequest.updateMany.mockResolvedValue({ count: 1 });
    h.stripe.refunds.create.mockResolvedValue({
      id: 're_claim',
      status: 'pending',
    });
    h.prisma.refundRequest.update.mockResolvedValue({});

    const result = await initiateLateJoinabilityCompensation('pay_1');

    expect(result).toEqual({
      status: 'refund-processing',
      refundRequestId: 'rr_existing',
      stripeRefundId: 're_claim',
    });
    expect(h.prisma.refundRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'rr_existing',
          status: {
            in: [
              RefundRequestStatus.requested,
              RefundRequestStatus.failed,
              RefundRequestStatus.rejected,
              RefundRequestStatus.canceled,
              RefundRequestStatus.approved,
            ],
          },
        },
        data: expect.objectContaining({
          source: RefundRequestSource.SYSTEM_COMPENSATION,
          status: RefundRequestStatus.processing,
        }),
      })
    );
  });

  it('marks compensation as failed and throws when refund creation fails', async () => {
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_1',
      userId: 'user_1',
      status: PaymentStatus.succeeded,
      amountCents: 5000,
      stripeChargeId: 'ch_1',
      stripePaymentIntentId: 'pi_1',
      payoutTarget: PaymentPayoutTarget.platform,
      refundRequest: null,
    });
    h.prisma.refundRequest.create.mockResolvedValue({ id: 'rr_1' });
    h.stripe.refunds.create.mockRejectedValue(new Error('Stripe unavailable'));
    h.prisma.refundRequest.updateMany.mockResolvedValue({ count: 1 });

    await expect(initiateLateJoinabilityCompensation('pay_1')).rejects.toThrow(
      /stripe unavailable/i
    );

    expect(h.prisma.refundRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'rr_1',
          status: { not: RefundRequestStatus.succeeded },
        },
        data: expect.objectContaining({
          status: RefundRequestStatus.failed,
        }),
      })
    );
  });
});

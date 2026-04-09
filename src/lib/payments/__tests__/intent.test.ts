import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PaymentPayoutTarget,
  PaymentStatus,
  RSVPAttendanceEntitlementStatus,
  RSVPStatus,
} from '@/generated/prisma';
import {
  ConnectNotReadyError,
  EventNotJoinableError,
  NotPayableError,
} from '@/lib/payments/errors';
import type { TicketStateResult } from '@/types/payments/stripe';

const h = vi.hoisted(() => ({
  connectReady: undefined as boolean | undefined,
  platformFeeBps: 0,
  platformFeeCents: 0,
  prisma: {
    event: {
      findUnique: vi.fn(),
    },
    payment: {
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    rSVP: {
      findFirst: vi.fn(),
    },
  },
  stripe: {
    paymentIntents: {
      create: vi.fn(),
      retrieve: vi.fn(),
      cancel: vi.fn(),
    },
    refunds: {
      retrieve: vi.fn(),
    },
  },
}));

vi.mock('@/lib/prisma', () => {
  return { prisma: h.prisma };
});

vi.mock('@/lib/stripe', () => {
  return { stripe: h.stripe };
});

vi.mock('@/lib/payments/stripeConnectReadiness', async () => {
  const { buildConnectConfigMock } = await import('@/test-utils/mockConnectConfig');
  return buildConnectConfigMock(h);
});

vi.mock('@/lib/payments/platformFee.server', async () => {
  const { buildPlatformFeeServerMock } = await import('@/test-utils/mockConnectConfig');
  return buildPlatformFeeServerMock(h);
});

import { createOrReusePaymentIntentForEvent } from '@/lib/payments/intent';

const ORIGINAL_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
type PaymentInProgressResult = Extract<
  TicketStateResult,
  { state: 'PAYMENT_IN_PROGRESS' }
>;
type AlreadyPaidResult = Extract<
  TicketStateResult,
  { state: 'ALREADY_PAID_ATTENDING' | 'ALREADY_PAID_NOT_ATTENDING' }
>;

function expectPaymentInProgress(
  result: TicketStateResult
): PaymentInProgressResult {
  expect(result.state).toBe('PAYMENT_IN_PROGRESS');
  if (result.state !== 'PAYMENT_IN_PROGRESS') {
    throw new Error(`Expected PAYMENT_IN_PROGRESS, got ${result.state}`);
  }
  return result;
}

function expectAlreadyPaid(
  result: TicketStateResult,
  expectedState: AlreadyPaidResult['state']
): AlreadyPaidResult {
  expect(result.state).toBe(expectedState);
  if (
    result.state !== 'ALREADY_PAID_ATTENDING' &&
    result.state !== 'ALREADY_PAID_NOT_ATTENDING'
  ) {
    throw new Error(`Expected already-paid state, got ${result.state}`);
  }
  return result;
}

const makeEvent = (id: string, priceCents = 5000) => ({
  id,
  title: 'Test Event',
  description: 'A test event',
  date: new Date('2099-01-01T12:00:00Z'),
  location: 'New York',
  category: 'tech',
  eventTimeZone: 'America/New_York',
  contactEmail: 'contact@example.com',
  contactPhone: null,
  contactPhoneApps: null,
  isPaid: true,
  priceCents,
  currency: 'USD',
  archivedAt: null,
  currentPriceVersionId: 'pv_current',
  currentPriceVersion: {
    id: 'pv_current',
    isPaid: true,
    amountCents: priceCents,
    currency: 'USD',
  },
  creator: {
    clerkId: 'org_1',
    username: 'testorg',
    firstName: 'Test',
    lastName: 'Org',
    imageUrl: null,
    hasImage: false,
    role: 'organizer',
    stripeConnectAccountId: 'acct_ready_default',
    stripeConnectPayoutsEnabled: true,
    stripeConnectChargesEnabled: true,
    stripeConnectDetailsSubmitted: true,
  },
});

describe('createOrReusePaymentIntentForEvent', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_123';
    h.connectReady = undefined;
    h.platformFeeBps = 0;
    h.platformFeeCents = 0;

    h.prisma.event.findUnique.mockReset();
    h.prisma.payment.findFirst.mockReset();
    h.prisma.payment.create.mockReset();
    h.prisma.payment.updateMany.mockReset();
    h.prisma.payment.updateMany.mockResolvedValue({ count: 1 });
    h.prisma.rSVP.findFirst.mockReset();
    h.stripe.paymentIntents.create.mockReset();
    h.stripe.paymentIntents.retrieve.mockReset();
    h.stripe.paymentIntents.cancel.mockReset();
    h.stripe.refunds.retrieve.mockReset();
  });

  afterAll(() => {
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = ORIGINAL_PUBLISHABLE_KEY;
  });

  describe('ALREADY_PAID states', () => {
    it('returns ALREADY_PAID_ATTENDING when succeeded payment with confirmed RSVP exists', async () => {
      const eventId = 'evt_1';
      const userId = 'user_123';

      h.prisma.event.findUnique.mockResolvedValue(makeEvent(eventId));
      h.prisma.payment.findFirst.mockResolvedValueOnce({
        id: 'pay_1',
        stripePaymentIntentId: 'pi_1',
        status: PaymentStatus.succeeded,
        eventId,
        userId,
      });
      h.prisma.rSVP.findFirst.mockResolvedValueOnce({
        id: 'rsvp_1',
        eventId,
        userId,
        status: RSVPStatus.confirmed,
      });

      const result = (await createOrReusePaymentIntentForEvent({
        eventId,
        userId,
      })) as TicketStateResult;

      const paidResult = expectAlreadyPaid(result, 'ALREADY_PAID_ATTENDING');
      expect(paidResult.event).toBeDefined();
      expect(paidResult.paymentIntentId).toBe('pi_1');
    });

    it('returns ALREADY_PAID_NOT_ATTENDING when succeeded payment with non-confirmed RSVP exists', async () => {
      const eventId = 'evt_1';
      const userId = 'user_123';

      h.prisma.event.findUnique.mockResolvedValue(makeEvent(eventId));
      h.prisma.payment.findFirst.mockResolvedValueOnce({
        id: 'pay_1',
        stripePaymentIntentId: 'pi_1',
        status: PaymentStatus.succeeded,
        eventId,
        userId,
      });
      h.prisma.rSVP.findFirst.mockResolvedValueOnce({
        id: 'rsvp_1',
        eventId,
        userId,
        status: RSVPStatus.canceled,
      });

      const result = (await createOrReusePaymentIntentForEvent({
        eventId,
        userId,
      })) as TicketStateResult;

      const paidResult = expectAlreadyPaid(result, 'ALREADY_PAID_NOT_ATTENDING');
      expect(paidResult.event).toBeDefined();
      expect(paidResult.paymentIntentId).toBe('pi_1');
    });

    it('returns ALREADY_PAID_NOT_ATTENDING when succeeded payment with no RSVP exists', async () => {
      const eventId = 'evt_1';
      const userId = 'user_123';

      h.prisma.event.findUnique.mockResolvedValue(makeEvent(eventId));
      h.prisma.payment.findFirst.mockResolvedValueOnce({
        id: 'pay_1',
        stripePaymentIntentId: 'pi_1',
        status: PaymentStatus.succeeded,
        eventId,
        userId,
      });
      h.prisma.rSVP.findFirst.mockResolvedValueOnce(null);

      const result = (await createOrReusePaymentIntentForEvent({
        eventId,
        userId,
      })) as TicketStateResult;

      const paidResult = expectAlreadyPaid(result, 'ALREADY_PAID_NOT_ATTENDING');
      expect(paidResult.event).toBeDefined();
      expect(paidResult.paymentIntentId).toBe('pi_1');
    });

    it('returns ALREADY_PAID_NOT_ATTENDING when RSVP is confirmed but entitlement is revoked', async () => {
      const eventId = 'evt_1';
      const userId = 'user_123';

      h.prisma.event.findUnique.mockResolvedValue(makeEvent(eventId));
      h.prisma.payment.findFirst.mockResolvedValueOnce({
        id: 'pay_1',
        stripePaymentIntentId: 'pi_1',
        status: PaymentStatus.succeeded,
        amountCents: 5000,
        eventId,
        userId,
        refundRequest: null,
      });
      h.prisma.rSVP.findFirst.mockResolvedValueOnce({
        id: 'rsvp_1',
        eventId,
        userId,
        status: RSVPStatus.confirmed,
        attendanceEntitlementStatus: RSVPAttendanceEntitlementStatus.revoked_refunded,
      });

      const result = (await createOrReusePaymentIntentForEvent({
        eventId,
        userId,
      })) as TicketStateResult;

      const paidResult = expectAlreadyPaid(result, 'ALREADY_PAID_NOT_ATTENDING');
      expect(paidResult.event).toBeDefined();
      expect(paidResult.paymentIntentId).toBe('pi_1');
    });

    it('blocks repurchase when prior payment refund is pending', async () => {
      const eventId = 'evt_1';
      const userId = 'user_123';

      h.prisma.event.findUnique.mockResolvedValue(makeEvent(eventId));
      h.prisma.payment.findFirst.mockResolvedValueOnce({
        id: 'pay_1',
        stripePaymentIntentId: 'pi_1',
        status: PaymentStatus.succeeded,
        amountCents: 5000,
        eventId,
        userId,
        refundRequest: {
          status: 'processing',
          stripeRefundId: 're_pending',
        },
      });

      await expect(
        createOrReusePaymentIntentForEvent({
          eventId,
          userId,
        })
      ).rejects.toThrow(/refund is still processing/i);

      expect(h.prisma.rSVP.findFirst).not.toHaveBeenCalled();
      expect(h.stripe.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('allows repurchase when prior payment was fully refunded', async () => {
      const eventId = 'evt_1';
      const userId = 'user_123';
      const refundedPaymentId = 'pay_refunded';
      const previousPaymentIntentId = 'pi_old';

      h.prisma.event.findUnique.mockResolvedValue(makeEvent(eventId));
      h.prisma.payment.findFirst
        .mockResolvedValueOnce({
          id: refundedPaymentId,
          stripePaymentIntentId: previousPaymentIntentId,
          status: PaymentStatus.succeeded,
          amountCents: 5000,
          eventId,
          userId,
          refundRequest: {
            status: 'succeeded',
            stripeRefundId: 're_full',
          },
        })
        .mockResolvedValueOnce(null);

      h.stripe.refunds.retrieve.mockResolvedValue({
        id: 're_full',
        amount: 5000,
      });
      h.stripe.paymentIntents.create.mockResolvedValue({
        id: 'pi_new',
        client_secret: 'pi_new_secret',
        status: 'requires_payment_method',
      });
      h.prisma.payment.create.mockResolvedValue({
        id: 'pay_2',
        stripePaymentIntentId: 'pi_new',
        status: PaymentStatus.pending,
        amountCents: 5000,
        currency: 'USD',
        eventId,
        userId,
        priceVersionId: 'pv_current',
      });

      const result = await createOrReusePaymentIntentForEvent({ eventId, userId });
      const inProgress = expectPaymentInProgress(result);
      expect(inProgress.paymentIntentId).toBe('pi_new');
      expect(inProgress.paymentIntentId).not.toBe(previousPaymentIntentId);
      expect(h.stripe.paymentIntents.create).toHaveBeenCalled();
      expect(h.prisma.rSVP.findFirst).not.toHaveBeenCalled();
      expect(h.stripe.paymentIntents.create).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          idempotencyKey: `paid_rsvp_${eventId}_${userId}_pv_current_${PaymentPayoutTarget.organizer}_repurchase_${refundedPaymentId}`,
        })
      );
      expect(h.prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            stripePaymentIntentId: 'pi_new',
          }),
        })
      );
    });

    it('does not treat partial succeeded refund as refunded (keeps already-paid state)', async () => {
      const eventId = 'evt_1';
      const userId = 'user_123';

      h.prisma.event.findUnique.mockResolvedValue(makeEvent(eventId));
      h.prisma.payment.findFirst.mockResolvedValueOnce({
        id: 'pay_1',
        stripePaymentIntentId: 'pi_1',
        status: PaymentStatus.succeeded,
        amountCents: 5000,
        eventId,
        userId,
        refundRequest: {
          status: 'succeeded',
          stripeRefundId: 're_partial',
        },
      });
      h.stripe.refunds.retrieve.mockResolvedValue({
        id: 're_partial',
        amount: 1200,
      });
      h.prisma.rSVP.findFirst.mockResolvedValueOnce({
        id: 'rsvp_1',
        eventId,
        userId,
        status: RSVPStatus.canceled,
      });

      const result = (await createOrReusePaymentIntentForEvent({
        eventId,
        userId,
      })) as TicketStateResult;

      expectAlreadyPaid(result, 'ALREADY_PAID_NOT_ATTENDING');
      expect(h.stripe.paymentIntents.create).not.toHaveBeenCalled();
    });
  });

  describe('PAYMENT_IN_PROGRESS state', () => {
    it('reuses existing pending PaymentIntent when found', async () => {
      const eventId = 'evt_1';
      const userId = 'user_123';

      h.prisma.event.findUnique.mockResolvedValue(makeEvent(eventId));
      h.prisma.payment.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'pay_1',
          stripePaymentIntentId: 'pi_1',
          status: PaymentStatus.pending,
          amountCents: 5000,
          currency: 'USD',
          eventId,
          userId,
          priceVersionId: 'pv_current',
        });

      h.stripe.paymentIntents.retrieve.mockResolvedValue({
        id: 'pi_1',
        client_secret: 'pi_1_secret',
        status: 'requires_payment_method',
        transfer_data: { destination: 'acct_ready_default' },
        transfer_group: `event:${eventId}`,
      });

      const result = (await createOrReusePaymentIntentForEvent({
        eventId,
        userId,
      })) as TicketStateResult;

      const inProgress = expectPaymentInProgress(result);
      expect(inProgress.clientSecret).toBe('pi_1_secret');
      expect(inProgress.paymentIntentId).toBe('pi_1');
      expect(inProgress.publishableKey).toBe('pk_test_123');
      expect(inProgress.event).toBeDefined();
      expect(inProgress.event.priceCents).toBe(5000);
      expect(inProgress.event.currency).toBe('USD');
      expect(h.stripe.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('replaces a reusable pending PI when application fee routing no longer matches', async () => {
      const eventId = 'evt_fee_mismatch';
      const userId = 'user_123';

      h.platformFeeCents = 125;

      h.prisma.event.findUnique.mockResolvedValue(makeEvent(eventId));
      h.prisma.payment.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'pay_existing',
          stripePaymentIntentId: 'pi_existing',
          status: PaymentStatus.pending,
          amountCents: 5000,
          currency: 'USD',
          eventId,
          userId,
          priceVersionId: 'pv_current',
        });
      h.prisma.payment.create.mockResolvedValue({
        id: 'pay_new',
        stripePaymentIntentId: 'pi_new_fee',
        status: PaymentStatus.pending,
        amountCents: 5000,
        currency: 'USD',
        eventId,
        userId,
        priceVersionId: 'pv_current',
      });

      h.stripe.paymentIntents.retrieve.mockResolvedValue({
        id: 'pi_existing',
        client_secret: 'pi_existing_secret',
        status: 'requires_payment_method',
        transfer_data: { destination: 'acct_ready_default' },
        transfer_group: `event:${eventId}`,
      });
      h.stripe.paymentIntents.cancel.mockResolvedValue({
        id: 'pi_existing',
        status: 'canceled',
      });
      h.stripe.paymentIntents.create.mockResolvedValue({
        id: 'pi_new_fee',
        client_secret: 'pi_new_fee_secret',
        status: 'requires_payment_method',
      });

      const result = await createOrReusePaymentIntentForEvent({ eventId, userId });

      const inProgress = expectPaymentInProgress(result);
      expect(inProgress.paymentIntentId).toBe('pi_new_fee');
      expect(h.stripe.paymentIntents.cancel).toHaveBeenCalledWith('pi_existing');
      expect(h.stripe.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          application_fee_amount: 125,
          transfer_data: { destination: 'acct_ready_default' },
        }),
        expect.any(Object)
      );
    });

    it('creates new PaymentIntent when none exists', async () => {
      const eventId = 'evt_1';
      const userId = 'user_123';

      h.prisma.event.findUnique.mockResolvedValue(makeEvent(eventId));
      h.prisma.payment.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      h.prisma.payment.create.mockResolvedValue({
        id: 'pay_2',
        stripePaymentIntentId: 'pi_2',
        status: PaymentStatus.pending,
        amountCents: 5000,
        currency: 'USD',
        eventId,
        userId,
        priceVersionId: 'pv_current',
      });

      h.stripe.paymentIntents.create.mockResolvedValue({
        id: 'pi_2',
        client_secret: 'pi_2_secret',
        status: 'requires_payment_method',
      });

      const result = (await createOrReusePaymentIntentForEvent({
        eventId,
        userId,
      })) as TicketStateResult;

      const inProgress = expectPaymentInProgress(result);
      expect(inProgress.clientSecret).toBe('pi_2_secret');
      expect(inProgress.paymentIntentId).toBe('pi_2');
      expect(inProgress.publishableKey).toBe('pk_test_123');
      expect(inProgress.event).toBeDefined();
      expect(h.stripe.paymentIntents.create).toHaveBeenCalled();
      expect(h.prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            stripePaymentIntentId: 'pi_2',
            amountCents: 5000,
            currency: 'USD',
            eventId,
            userId,
            priceVersionId: 'pv_current',
          }),
        })
      );
    });

    it('fails when Stripe create returns a terminal payment intent status', async () => {
      const eventId = 'evt_terminal_create';
      const userId = 'user_123';

      h.prisma.event.findUnique.mockResolvedValue(makeEvent(eventId));
      h.prisma.payment.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

      h.stripe.paymentIntents.create.mockResolvedValue({
        id: 'pi_terminal_create',
        client_secret: 'pi_terminal_create_secret',
        status: 'succeeded',
      });

      await expect(
        createOrReusePaymentIntentForEvent({
          eventId,
          userId,
        })
      ).rejects.toThrow(/non-checkout payment intent status/i);

      expect(h.prisma.payment.create).not.toHaveBeenCalled();
    });

    it('fails closed when DB create conflict resolves to terminal PI in non-repurchase mode', async () => {
      const eventId = 'evt_terminal_fallback';
      const userId = 'user_123';

      h.prisma.event.findUnique.mockResolvedValue(makeEvent(eventId));
      h.prisma.payment.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'pay_existing',
          stripePaymentIntentId: 'pi_conflict',
          amountCents: 5000,
          currency: 'USD',
        });

      h.stripe.paymentIntents.create.mockResolvedValue({
        id: 'pi_conflict',
        client_secret: 'pi_conflict_secret',
        status: 'requires_payment_method',
      });
      h.prisma.payment.create.mockRejectedValueOnce(
        new Error('Unique constraint failed on the fields: (`stripePaymentIntentId`)')
      );
      h.stripe.paymentIntents.retrieve.mockResolvedValue({
        id: 'pi_conflict',
        client_secret: 'pi_conflict_secret',
        status: 'succeeded',
      });

      await expect(
        createOrReusePaymentIntentForEvent({
          eventId,
          userId,
        })
      ).rejects.toThrow(/previous payment is already completed/i);

      expect(h.stripe.paymentIntents.create).toHaveBeenCalledTimes(1);
    });

    it('creates a replacement PI when fallback resolves to terminal PI in refunded repurchase mode', async () => {
      const eventId = 'evt_repurchase_recovery';
      const userId = 'user_123';
      const refundedPaymentId = 'pay_refunded';

      h.prisma.event.findUnique.mockResolvedValue(makeEvent(eventId));
      h.prisma.payment.findFirst
        .mockResolvedValueOnce({
          id: refundedPaymentId,
          stripePaymentIntentId: 'pi_old_refunded',
          status: PaymentStatus.succeeded,
          amountCents: 5000,
          eventId,
          userId,
          refundRequest: {
            status: 'succeeded',
            stripeRefundId: 're_full',
          },
        })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'pay_existing',
          stripePaymentIntentId: 'pi_conflict',
          amountCents: 5000,
          currency: 'USD',
        });
      h.stripe.refunds.retrieve.mockResolvedValue({
        id: 're_full',
        amount: 5000,
      });
      h.stripe.paymentIntents.create
        .mockResolvedValueOnce({
          id: 'pi_conflict',
          client_secret: 'pi_conflict_secret',
          status: 'requires_payment_method',
        })
        .mockResolvedValueOnce({
          id: 'pi_recovery',
          client_secret: 'pi_recovery_secret',
          status: 'requires_payment_method',
        });
      h.prisma.payment.create
        .mockRejectedValueOnce(
          new Error('Unique constraint failed on the fields: (`stripePaymentIntentId`)')
        )
        .mockResolvedValueOnce({
          id: 'pay_recovery',
          stripePaymentIntentId: 'pi_recovery',
          status: PaymentStatus.pending,
          amountCents: 5000,
          currency: 'USD',
          eventId,
          userId,
          priceVersionId: 'pv_current',
        });
      h.stripe.paymentIntents.retrieve.mockResolvedValue({
        id: 'pi_conflict',
        client_secret: 'pi_conflict_secret',
        status: 'succeeded',
      });

      const result = await createOrReusePaymentIntentForEvent({ eventId, userId });
      const inProgress = expectPaymentInProgress(result);
      expect(inProgress.paymentIntentId).toBe('pi_recovery');

      expect(h.stripe.paymentIntents.create).toHaveBeenCalledTimes(2);
      expect(h.stripe.paymentIntents.create).toHaveBeenNthCalledWith(
        1,
        expect.any(Object),
        expect.objectContaining({
          idempotencyKey: `paid_rsvp_${eventId}_${userId}_pv_current_${PaymentPayoutTarget.organizer}_repurchase_${refundedPaymentId}`,
        })
      );
      expect(h.stripe.paymentIntents.create).toHaveBeenNthCalledWith(
        2,
        expect.any(Object),
        expect.objectContaining({
          idempotencyKey: `paid_rsvp_${eventId}_${userId}_pv_current_${PaymentPayoutTarget.organizer}_repurchase_${refundedPaymentId}_recovery_pi_conflict`,
        })
      );
    });

    it('adds destination-charge routing params when Connect routing is eligible', async () => {
      const eventId = 'evt_connect';
      const userId = 'user_123';

      h.platformFeeCents = 125;

      h.prisma.event.findUnique.mockResolvedValueOnce({
        ...makeEvent(eventId, 5000),
        creator: {
          ...makeEvent(eventId, 5000).creator,
          role: 'organizer',
          stripeConnectAccountId: 'acct_eligible',
          stripeConnectPayoutsEnabled: true,
          stripeConnectChargesEnabled: true,
          stripeConnectDetailsSubmitted: true,
        },
      });
      h.prisma.payment.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      h.prisma.payment.create.mockResolvedValue({
        id: 'pay_connect',
        stripePaymentIntentId: 'pi_connect',
        status: PaymentStatus.pending,
        amountCents: 5000,
        currency: 'USD',
        eventId,
        userId,
        priceVersionId: 'pv_current',
      });
      h.stripe.paymentIntents.create.mockResolvedValue({
        id: 'pi_connect',
        client_secret: 'pi_connect_secret',
        status: 'requires_payment_method',
      });

      await createOrReusePaymentIntentForEvent({ eventId, userId });

      expect(h.stripe.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          transfer_data: { destination: 'acct_eligible' },
          transfer_group: `event:${eventId}`,
          application_fee_amount: 125,
        }),
        expect.any(Object)
      );
      expect(h.prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            destinationAccountId: 'acct_eligible',
            transferGroup: `event:${eventId}`,
            applicationFeeAmount: 125,
          }),
        })
      );
    });

    it('blocks paid organizer events when Connect is not ready and does not create a PI', async () => {
      const eventId = 'evt_connect_not_ready';
      const userId = 'user_123';

      h.prisma.event.findUnique.mockResolvedValue({
        ...makeEvent(eventId, 5000),
        creator: {
          ...makeEvent(eventId, 5000).creator,
          stripeConnectAccountId: 'acct_incomplete',
          stripeConnectPayoutsEnabled: true,
          stripeConnectChargesEnabled: true,
          stripeConnectDetailsSubmitted: false,
        },
      });
      h.prisma.payment.findFirst.mockResolvedValueOnce(null);

      await expect(
        createOrReusePaymentIntentForEvent({ eventId, userId })
      ).rejects.toBeInstanceOf(ConnectNotReadyError);

      expect(h.stripe.paymentIntents.create).not.toHaveBeenCalled();
      expect(h.prisma.payment.create).not.toHaveBeenCalled();
    });

    it('creates platform-mode paid intents for admin-owned events', async () => {
      const eventId = 'evt_invalid_owner';
      const userId = 'user_123';

      h.prisma.event.findUnique.mockResolvedValue({
        ...makeEvent(eventId, 5000),
        creator: {
          ...makeEvent(eventId, 5000).creator,
          role: 'admin',
        },
      });
      h.prisma.payment.findFirst.mockResolvedValueOnce(null);
      h.prisma.payment.create.mockResolvedValue({
        id: 'pay_platform',
        stripePaymentIntentId: 'pi_platform',
        status: PaymentStatus.pending,
        amountCents: 5000,
        currency: 'USD',
        eventId,
        userId,
        payoutTarget: PaymentPayoutTarget.platform,
        priceVersionId: 'pv_current',
      });
      h.stripe.paymentIntents.create.mockResolvedValue({
        id: 'pi_platform',
        client_secret: 'pi_platform_secret',
        status: 'requires_payment_method',
      });

      await createOrReusePaymentIntentForEvent({ eventId, userId });

      const [params, options] = h.stripe.paymentIntents.create.mock.calls[0];
      expect(params).not.toHaveProperty('transfer_data');
      expect(params).not.toHaveProperty('application_fee_amount');
      expect(params).toEqual(
        expect.objectContaining({
          transfer_group: `event:${eventId}`,
          metadata: expect.objectContaining({
            payoutTarget: PaymentPayoutTarget.platform,
          }),
        })
      );
      expect(options).toEqual(
        expect.objectContaining({
          idempotencyKey: `paid_rsvp_${eventId}_${userId}_pv_current_${PaymentPayoutTarget.platform}`,
        })
      );
      expect(h.prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            payoutTarget: PaymentPayoutTarget.platform,
            destinationAccountId: null,
            transferGroup: `event:${eventId}`,
            applicationFeeAmount: null,
          }),
        })
      );
    });

    it('uses version-aware idempotency key and metadata from current price version', async () => {
      const eventId = 'evt_1';
      const userId = 'user_123';
      const expectedIdempotencyKey = `paid_rsvp_${eventId}_${userId}_pv_current_${PaymentPayoutTarget.organizer}`;

      h.prisma.event.findUnique.mockResolvedValue(makeEvent(eventId));
      h.prisma.payment.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      h.prisma.payment.create.mockResolvedValue({
        id: 'pay_2',
        stripePaymentIntentId: 'pi_2',
        status: PaymentStatus.pending,
        amountCents: 5000,
        currency: 'USD',
        eventId,
        userId,
        priceVersionId: 'pv_current',
      });

      h.stripe.paymentIntents.create.mockResolvedValue({
        id: 'pi_2',
        client_secret: 'pi_2_secret',
        status: 'requires_payment_method',
      });

      await createOrReusePaymentIntentForEvent({ eventId, userId });

      expect(h.stripe.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 5000,
          currency: 'usd',
          metadata: {
            eventId,
            userId,
            priceVersionId: 'pv_current',
            amountCents: '5000',
            currency: 'USD',
            payoutTarget: PaymentPayoutTarget.organizer,
          },
        }),
        expect.objectContaining({
          idempotencyKey: expectedIdempotencyKey,
        })
      );
    });

    it('cancels stale pre-confirmation pending PI and creates a new PI at the latest price version', async () => {
      const eventId = 'evt_1';
      const userId = 'user_123';

      h.prisma.event.findUnique.mockResolvedValue(makeEvent(eventId, 500));
      h.prisma.payment.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'pay_stale',
          stripePaymentIntentId: 'pi_old',
          status: PaymentStatus.pending,
          amountCents: 1000,
          currency: 'USD',
          eventId,
          userId,
          priceVersionId: 'pv_old',
        });
      h.prisma.payment.create.mockResolvedValue({
        id: 'pay_new',
        stripePaymentIntentId: 'pi_new',
        status: PaymentStatus.pending,
        amountCents: 500,
        currency: 'USD',
        eventId,
        userId,
        priceVersionId: 'pv_current',
      });

      h.stripe.paymentIntents.retrieve.mockResolvedValue({
        id: 'pi_old',
        client_secret: 'pi_old_secret',
        status: 'requires_payment_method',
        transfer_data: { destination: 'acct_ready_default' },
      });
      h.stripe.paymentIntents.cancel.mockResolvedValue({
        id: 'pi_old',
        status: 'canceled',
      });
      h.stripe.paymentIntents.create.mockResolvedValue({
        id: 'pi_new',
        client_secret: 'pi_new_secret',
        status: 'requires_payment_method',
      });

      const result = (await createOrReusePaymentIntentForEvent({
        eventId,
        userId,
      })) as TicketStateResult;

      const inProgress = expectPaymentInProgress(result);
      expect(inProgress.paymentIntentId).toBe('pi_new');
      expect(inProgress.event.priceCents).toBe(500);

      expect(h.stripe.paymentIntents.cancel).toHaveBeenCalledWith('pi_old');
      expect(h.prisma.payment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pay_stale', status: PaymentStatus.pending },
          data: { status: PaymentStatus.canceled },
        })
      );
      expect(h.stripe.paymentIntents.create).toHaveBeenCalled();
      expect(h.prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amountCents: 500,
            priceVersionId: 'pv_current',
          }),
        })
      );
    });

    it('replaces a current-version pending PI that is missing marketplace routing', async () => {
      const eventId = 'evt_replace_platform_only';
      const userId = 'user_123';

      h.prisma.event.findUnique.mockResolvedValue(makeEvent(eventId, 5000));
      h.prisma.payment.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'pay_platform_only',
          stripePaymentIntentId: 'pi_platform_only',
          status: PaymentStatus.pending,
          amountCents: 5000,
          currency: 'USD',
          eventId,
          userId,
          priceVersionId: 'pv_current',
        });
      h.prisma.payment.create.mockResolvedValue({
        id: 'pay_routed',
        stripePaymentIntentId: 'pi_routed',
        status: PaymentStatus.pending,
        amountCents: 5000,
        currency: 'USD',
        eventId,
        userId,
        priceVersionId: 'pv_current',
      });

      h.stripe.paymentIntents.retrieve.mockResolvedValue({
        id: 'pi_platform_only',
        client_secret: 'pi_platform_only_secret',
        status: 'requires_payment_method',
      });
      h.stripe.paymentIntents.cancel.mockResolvedValue({
        id: 'pi_platform_only',
        status: 'canceled',
      });
      h.stripe.paymentIntents.create.mockResolvedValue({
        id: 'pi_routed',
        client_secret: 'pi_routed_secret',
        status: 'requires_payment_method',
      });

      const result = await createOrReusePaymentIntentForEvent({ eventId, userId });

      const inProgress = expectPaymentInProgress(result);
      expect(inProgress.paymentIntentId).toBe('pi_routed');
      expect(h.stripe.paymentIntents.cancel).toHaveBeenCalledWith('pi_platform_only');
      expect(h.stripe.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          transfer_data: { destination: 'acct_ready_default' },
        }),
        expect.any(Object)
      );
    });

    it('reuses a current-version pending platform PI when destination routing is absent', async () => {
      const eventId = 'evt_platform_reuse';
      const userId = 'user_123';

      h.prisma.event.findUnique.mockResolvedValue({
        ...makeEvent(eventId, 5000),
        creator: {
          ...makeEvent(eventId, 5000).creator,
          role: 'admin',
        },
      });
      h.prisma.payment.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'pay_platform_existing',
          stripePaymentIntentId: 'pi_platform_existing',
          status: PaymentStatus.pending,
          amountCents: 5000,
          currency: 'USD',
          eventId,
          userId,
          payoutTarget: PaymentPayoutTarget.platform,
          priceVersionId: 'pv_current',
        });

      h.stripe.paymentIntents.retrieve.mockResolvedValue({
        id: 'pi_platform_existing',
        client_secret: 'pi_platform_existing_secret',
        status: 'requires_payment_method',
        transfer_group: `event:${eventId}`,
      });

      const result = await createOrReusePaymentIntentForEvent({ eventId, userId });

      const inProgress = expectPaymentInProgress(result);
      expect(inProgress.paymentIntentId).toBe('pi_platform_existing');
      expect(h.stripe.paymentIntents.cancel).not.toHaveBeenCalled();
      expect(h.stripe.paymentIntents.create).not.toHaveBeenCalled();
      expect(h.prisma.payment.create).not.toHaveBeenCalled();
    });

    it('returns the stale in-flight PI (old locked price) and does not create a second PI', async () => {
      const eventId = 'evt_1';
      const userId = 'user_123';

      h.prisma.event.findUnique.mockResolvedValue(makeEvent(eventId, 500));
      h.prisma.payment.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'pay_stale',
          stripePaymentIntentId: 'pi_old',
          status: PaymentStatus.pending,
          amountCents: 1000,
          currency: 'USD',
          eventId,
          userId,
          priceVersionId: 'pv_old',
        });

      h.stripe.paymentIntents.retrieve.mockResolvedValue({
        id: 'pi_old',
        client_secret: 'pi_old_secret',
        status: 'requires_action',
        transfer_data: { destination: 'acct_ready_default' },
        transfer_group: `event:${eventId}`,
      });

      const result = (await createOrReusePaymentIntentForEvent({
        eventId,
        userId,
      })) as TicketStateResult;

      const inProgress = expectPaymentInProgress(result);
      expect(inProgress.paymentIntentId).toBe('pi_old');
      expect(inProgress.clientSecret).toBe('pi_old_secret');
      // UI must show the locked old price if we continue the stale in-flight checkout
      expect(inProgress.event.priceCents).toBe(1000);
      expect(inProgress.event.currency).toBe('USD');
      expect(h.stripe.paymentIntents.cancel).not.toHaveBeenCalled();
      expect(h.prisma.payment.updateMany).not.toHaveBeenCalled();
      expect(h.stripe.paymentIntents.create).not.toHaveBeenCalled();
      expect(h.prisma.payment.create).not.toHaveBeenCalled();
    });

    it('fails closed when pending PI exists but Stripe retrieve fails (no second PI created)', async () => {
      const eventId = 'evt_1';
      const userId = 'user_123';

      h.prisma.event.findUnique.mockResolvedValue(makeEvent(eventId, 500));
      h.prisma.payment.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'pay_pending',
          stripePaymentIntentId: 'pi_pending',
          status: PaymentStatus.pending,
          amountCents: 500,
          currency: 'USD',
          eventId,
          userId,
          priceVersionId: 'pv_current',
        });

      h.stripe.paymentIntents.retrieve.mockRejectedValue(new Error('network timeout'));

      await expect(
        createOrReusePaymentIntentForEvent({
          eventId,
          userId,
        })
      ).rejects.toThrow(/already in progress|retry in a moment/i);

      expect(h.stripe.paymentIntents.create).not.toHaveBeenCalled();
      expect(h.prisma.payment.create).not.toHaveBeenCalled();
      expect(h.stripe.paymentIntents.cancel).not.toHaveBeenCalled();
      expect(h.prisma.payment.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('throws NotFoundError when event not found', async () => {
      h.prisma.event.findUnique.mockResolvedValue(null);

      await expect(
        createOrReusePaymentIntentForEvent({
          eventId: 'evt_missing',
          userId: 'user_123',
        })
      ).rejects.toThrow(/not found/i);
    });

    it('throws NotPayableError when the event creator tries to open paid checkout', async () => {
      const eventId = 'evt_creator_paid';
      const creatorId = 'org_1';
      h.prisma.event.findUnique.mockResolvedValue(makeEvent(eventId));

      await expect(
        createOrReusePaymentIntentForEvent({
          eventId,
          userId: creatorId,
        })
      ).rejects.toBeInstanceOf(NotPayableError);

      expect(h.prisma.payment.findFirst).not.toHaveBeenCalled();
      expect(h.stripe.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('throws EventNotJoinableError when event is archived', async () => {
      h.prisma.event.findUnique.mockResolvedValue({
        ...makeEvent('evt_archived'),
        archivedAt: new Date('2026-03-01T00:00:00.000Z'),
      });

      await expect(
        createOrReusePaymentIntentForEvent({
          eventId: 'evt_archived',
          userId: 'user_123',
        })
      ).rejects.toBeInstanceOf(EventNotJoinableError);

      expect(h.prisma.payment.findFirst).not.toHaveBeenCalled();
      expect(h.stripe.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('throws EventNotJoinableError when event already started', async () => {
      h.prisma.event.findUnique.mockResolvedValue({
        ...makeEvent('evt_started'),
        date: new Date('2000-01-01T00:00:00.000Z'),
      });

      await expect(
        createOrReusePaymentIntentForEvent({
          eventId: 'evt_started',
          userId: 'user_123',
        })
      ).rejects.toBeInstanceOf(EventNotJoinableError);

      expect(h.prisma.payment.findFirst).not.toHaveBeenCalled();
      expect(h.stripe.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('throws StripeApiError when Stripe API fails', async () => {
      h.prisma.event.findUnique.mockResolvedValue(makeEvent('evt_1'));
      h.prisma.payment.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

      h.stripe.paymentIntents.create.mockRejectedValue(
        new Error('Stripe API error')
      );

      await expect(
        createOrReusePaymentIntentForEvent({
          eventId: 'evt_1',
          userId: 'user_123',
        })
      ).rejects.toThrow();
    });
  });
});

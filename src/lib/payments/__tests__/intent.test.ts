import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentStatus, RSVPStatus } from '@/generated/prisma';
import type { TicketStateResult } from '@/types/payments/stripe';

const h = vi.hoisted(() => ({
  stripeApiKey: 'sk_test_123',
  prisma: {
    event: {
      findUniqueOrThrow: vi.fn(),
    },
    payment: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
    },
    stripe: {
      PaymentIntent: {
        create: vi.fn(),
        retrieve: vi.fn(),
      },
    },
  },
  stripe: {
    paymentIntents: {
      create: vi.fn(),
      retrieve: vi.fn(),
    },
  },
}));

vi.mock('@clerk/nextjs/server', () => {
  return { auth: async () => ({ userId: 'user_123' }) };
});

vi.mock('@/lib/prisma', () => {
  return { prisma: h.prisma };
});

vi.mock('stripe', () => {
  return {
    default: class Stripe {
      constructor(key: string) {}
      paymentIntents = h.stripe.paymentIntents;
    },
  };
});

import { createOrReusePaymentIntentForEvent } from '@/lib/payments/intent';

const makeEvent = (id: string, priceCents: number = 5000) => ({
  id,
  title: 'Test Event',
  isPaid: true,
  priceCents,
  currency: 'USD',
  createdBy: 'org_1',
  creator: {
    id: 'org_1',
    username: 'testorg',
    firstName: 'Test',
    lastName: 'Org',
    imageUrl: null,
    hasImage: false,
  },
});

const makeCheckoutEvent = (id: string, priceCents: number = 5000) => ({
  ...makeEvent(id, priceCents),
  date: new Date().toISOString(),
  location: 'New York',
  category: 'tech',
  description: 'A test event',
  eventTimeZone: 'America/New_York',
  contactEmail: 'contact@example.com',
  contactPhone: null,
  contactPhoneApps: null,
});

describe('createOrReusePaymentIntentForEvent', () => {
  beforeEach(() => {
    h.prisma.event.findUniqueOrThrow.mockReset();
    h.prisma.payment.findFirst.mockReset();
    h.prisma.payment.upsert.mockReset();
    h.stripe.paymentIntents.create.mockReset();
    h.stripe.paymentIntents.retrieve.mockReset();
  });

  describe('ALREADY_PAID states', () => {
    it('returns ALREADY_PAID_ATTENDING when succeeded payment with confirmed RSVP exists', async () => {
      const eventId = 'evt_1';
      const userId = 'user_123';

      h.prisma.event.findUniqueOrThrow.mockResolvedValue(makeEvent(eventId));
      h.prisma.payment.findFirst.mockResolvedValue({
        id: 'pay_1',
        stripePaymentIntentId: 'pi_1',
        status: PaymentStatus.succeeded,
        eventId,
        userId,
        rsvpId: 'rsvp_1',
        rsvp: { status: RSVPStatus.confirmed },
      });

      const result = (await createOrReusePaymentIntentForEvent({
        eventId,
        userId,
      })) as TicketStateResult;

      expect(result.state).toBe('ALREADY_PAID_ATTENDING');
      expect((result as any).event).toBeDefined();
      expect((result as any).paymentIntentId).toBe('pi_1');
    });

    it('returns ALREADY_PAID_NOT_ATTENDING when succeeded payment with non-confirmed RSVP exists', async () => {
      const eventId = 'evt_1';
      const userId = 'user_123';

      h.prisma.event.findUniqueOrThrow.mockResolvedValue(makeEvent(eventId));
      h.prisma.payment.findFirst.mockResolvedValue({
        id: 'pay_1',
        stripePaymentIntentId: 'pi_1',
        status: PaymentStatus.succeeded,
        eventId,
        userId,
        rsvpId: 'rsvp_1',
        rsvp: { status: RSVPStatus.canceled },
      });

      const result = (await createOrReusePaymentIntentForEvent({
        eventId,
        userId,
      })) as TicketStateResult;

      expect(result.state).toBe('ALREADY_PAID_NOT_ATTENDING');
      expect((result as any).event).toBeDefined();
      expect((result as any).paymentIntentId).toBe('pi_1');
    });

    it('returns ALREADY_PAID_NOT_ATTENDING when succeeded payment with no RSVP exists', async () => {
      const eventId = 'evt_1';
      const userId = 'user_123';

      h.prisma.event.findUniqueOrThrow.mockResolvedValue(makeEvent(eventId));
      h.prisma.payment.findFirst.mockResolvedValue({
        id: 'pay_1',
        stripePaymentIntentId: 'pi_1',
        status: PaymentStatus.succeeded,
        eventId,
        userId,
        rsvpId: null,
        rsvp: null,
      });

      const result = (await createOrReusePaymentIntentForEvent({
        eventId,
        userId,
      })) as TicketStateResult;

      expect(result.state).toBe('ALREADY_PAID_NOT_ATTENDING');
      expect((result as any).event).toBeDefined();
      expect((result as any).paymentIntentId).toBe('pi_1');
    });
  });

  describe('PAYMENT_IN_PROGRESS state', () => {
    it('reuses existing pending PaymentIntent when found', async () => {
      const eventId = 'evt_1';
      const userId = 'user_123';

      h.prisma.event.findUniqueOrThrow.mockResolvedValue(makeCheckoutEvent(eventId));
      h.prisma.payment.findFirst.mockResolvedValue({
        id: 'pay_1',
        stripePaymentIntentId: 'pi_1',
        status: PaymentStatus.pending,
        eventId,
        userId,
      });

      h.stripe.paymentIntents.retrieve.mockResolvedValue({
        id: 'pi_1',
        client_secret: 'pi_1_secret',
        status: 'requires_payment_method',
      });

      const result = (await createOrReusePaymentIntentForEvent({
        eventId,
        userId,
      })) as TicketStateResult;

      expect(result.state).toBe('PAYMENT_IN_PROGRESS');
      expect((result as any).clientSecret).toBe('pi_1_secret');
      expect((result as any).paymentIntentId).toBe('pi_1');
      expect((result as any).event).toBeDefined();
      expect(h.stripe.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('creates new PaymentIntent when none exists', async () => {
      const eventId = 'evt_1';
      const userId = 'user_123';

      h.prisma.event.findUniqueOrThrow.mockResolvedValue(makeCheckoutEvent(eventId));
      h.prisma.payment.findFirst.mockResolvedValue(null);

      const newPayment = {
        id: 'pay_2',
        stripePaymentIntentId: 'pi_2',
        status: PaymentStatus.pending,
        eventId,
        userId,
      };

      h.prisma.payment.upsert.mockResolvedValue(newPayment);

      h.stripe.paymentIntents.create.mockResolvedValue({
        id: 'pi_2',
        client_secret: 'pi_2_secret',
        status: 'requires_payment_method',
      });

      const result = (await createOrReusePaymentIntentForEvent({
        eventId,
        userId,
      })) as TicketStateResult;

      expect(result.state).toBe('PAYMENT_IN_PROGRESS');
      expect((result as any).clientSecret).toBe('pi_2_secret');
      expect((result as any).paymentIntentId).toBe('pi_2');
      expect((result as any).event).toBeDefined();
      expect(h.stripe.paymentIntents.create).toHaveBeenCalled();
    });

    it('uses idempotency key format paid_rsvp_{eventId}_{userId}', async () => {
      const eventId = 'evt_1';
      const userId = 'user_123';
      const expectedIdempotencyKey = `paid_rsvp_${eventId}_${userId}`;

      h.prisma.event.findUniqueOrThrow.mockResolvedValue(makeCheckoutEvent(eventId));
      h.prisma.payment.findFirst.mockResolvedValue(null);
      h.prisma.payment.upsert.mockResolvedValue({
        id: 'pay_2',
        stripePaymentIntentId: 'pi_2',
        status: PaymentStatus.pending,
        eventId,
        userId,
      });

      h.stripe.paymentIntents.create.mockResolvedValue({
        id: 'pi_2',
        client_secret: 'pi_2_secret',
        status: 'requires_payment_method',
      });

      await createOrReusePaymentIntentForEvent({ eventId, userId });

      expect(h.stripe.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotency_key: expectedIdempotencyKey,
        }),
        expect.any(Object)
      );
    });
  });

  describe('Error handling', () => {
    it('throws NotFoundError when event not found', async () => {
      h.prisma.event.findUniqueOrThrow.mockRejectedValue(new Error('Not found'));

      await expect(
        createOrReusePaymentIntentForEvent({
          eventId: 'evt_missing',
          userId: 'user_123',
        })
      ).rejects.toThrow();
    });

    it('throws StripeApiError when Stripe API fails', async () => {
      h.prisma.event.findUniqueOrThrow.mockResolvedValue(makeCheckoutEvent('evt_1'));
      h.prisma.payment.findFirst.mockResolvedValue(null);

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

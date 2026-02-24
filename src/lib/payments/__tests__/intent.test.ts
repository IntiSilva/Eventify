import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentStatus, RSVPStatus } from '@/generated/prisma';
import type { TicketStateResult } from '@/types/payments/stripe';

const h = vi.hoisted(() => ({
  prisma: {
    event: {
      findUnique: vi.fn(),
    },
    payment: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    rSVP: {
      findFirst: vi.fn(),
    },
  },
  stripe: {
    paymentIntents: {
      create: vi.fn(),
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

import { createOrReusePaymentIntentForEvent } from '@/lib/payments/intent';

const ORIGINAL_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

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
  creator: {
    clerkId: 'org_1',
    username: 'testorg',
    firstName: 'Test',
    lastName: 'Org',
    imageUrl: null,
    hasImage: false,
    role: 'user',
  },
});

describe('createOrReusePaymentIntentForEvent', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_123';

    h.prisma.event.findUnique.mockReset();
    h.prisma.payment.findFirst.mockReset();
    h.prisma.payment.create.mockReset();
    h.prisma.rSVP.findFirst.mockReset();
    h.stripe.paymentIntents.create.mockReset();
    h.stripe.paymentIntents.retrieve.mockReset();
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

      expect(result.state).toBe('ALREADY_PAID_ATTENDING');
      expect((result as any).event).toBeDefined();
      expect((result as any).paymentIntentId).toBe('pi_1');
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

      expect(result.state).toBe('ALREADY_PAID_NOT_ATTENDING');
      expect((result as any).event).toBeDefined();
      expect((result as any).paymentIntentId).toBe('pi_1');
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

      expect(result.state).toBe('ALREADY_PAID_NOT_ATTENDING');
      expect((result as any).event).toBeDefined();
      expect((result as any).paymentIntentId).toBe('pi_1');
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
      expect((result as any).publishableKey).toBe('pk_test_123');
      expect((result as any).event).toBeDefined();
      expect(h.stripe.paymentIntents.create).not.toHaveBeenCalled();
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
        eventId,
        userId,
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

      expect(result.state).toBe('PAYMENT_IN_PROGRESS');
      expect((result as any).clientSecret).toBe('pi_2_secret');
      expect((result as any).paymentIntentId).toBe('pi_2');
      expect((result as any).publishableKey).toBe('pk_test_123');
      expect((result as any).event).toBeDefined();
      expect(h.stripe.paymentIntents.create).toHaveBeenCalled();
      expect(h.prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            stripePaymentIntentId: 'pi_2',
            amountCents: 5000,
            currency: 'USD',
            eventId,
            userId,
          }),
        })
      );
    });

    it('uses idempotency key format paid_rsvp_{eventId}_{userId}', async () => {
      const eventId = 'evt_1';
      const userId = 'user_123';
      const expectedIdempotencyKey = `paid_rsvp_${eventId}_${userId}`;

      h.prisma.event.findUnique.mockResolvedValue(makeEvent(eventId));
      h.prisma.payment.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      h.prisma.payment.create.mockResolvedValue({
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
          amount: 5000,
          currency: 'usd',
          metadata: { eventId, userId },
        }),
        expect.objectContaining({
          idempotencyKey: expectedIdempotencyKey,
        })
      );
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

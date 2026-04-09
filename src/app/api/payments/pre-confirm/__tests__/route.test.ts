import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentStatus } from '@/generated/prisma';

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  prisma: {
    payment: {
      findUnique: vi.fn(),
    },
    event: {
      findUnique: vi.fn(),
    },
  },
  stripe: {
    paymentIntents: {
      retrieve: vi.fn(),
    },
  },
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: h.auth }));
vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }));
vi.mock('@/lib/stripe', () => ({ stripe: h.stripe }));

import { POST } from '@/app/api/payments/pre-confirm/route';

describe('POST /api/payments/pre-confirm', () => {
  beforeEach(() => {
    h.auth.mockReset();
    h.prisma.payment.findUnique.mockReset();
    h.prisma.event.findUnique.mockReset();
    h.stripe.paymentIntents.retrieve.mockReset();
  });

  it('passes for a valid joinable checkout session', async () => {
    h.auth.mockResolvedValue({ userId: 'user_1' });
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_1',
      userId: 'user_1',
      eventId: 'evt_1',
      amountCents: 2500,
      currency: 'USD',
      status: PaymentStatus.pending,
    });
    h.prisma.event.findUnique.mockResolvedValue({
      id: 'evt_1',
      date: new Date('2099-01-01T10:00:00.000Z'),
      archivedAt: null,
    });
    h.stripe.paymentIntents.retrieve.mockResolvedValue({
      id: 'pi_1',
      status: 'requires_payment_method',
      amount: 2500,
      currency: 'usd',
      metadata: {
        eventId: 'evt_1',
        userId: 'user_1',
      },
    });

    const res = await POST(
      new Request('http://localhost/api/payments/pre-confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          eventId: 'evt_1',
          paymentIntentId: 'pi_1',
        }),
      })
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      success: true,
      data: {
        paymentIntentId: 'pi_1',
        status: 'requires_payment_method',
      },
    });
    expect(h.stripe.paymentIntents.retrieve).toHaveBeenCalledWith('pi_1');
  });

  it('blocks when event is no longer joinable', async () => {
    h.auth.mockResolvedValue({ userId: 'user_1' });
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_1',
      userId: 'user_1',
      eventId: 'evt_1',
      amountCents: 2500,
      currency: 'USD',
      status: PaymentStatus.pending,
    });
    h.prisma.event.findUnique.mockResolvedValue({
      id: 'evt_1',
      date: new Date('2000-01-01T10:00:00.000Z'),
      archivedAt: null,
    });

    const res = await POST(
      new Request('http://localhost/api/payments/pre-confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          eventId: 'evt_1',
          paymentIntentId: 'pi_1',
        }),
      })
    );

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.errorCode).toBe('EVENT_NOT_JOINABLE');
    expect(h.stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });

  it('blocks auth ownership mismatch', async () => {
    h.auth.mockResolvedValue({ userId: 'user_1' });
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_1',
      userId: 'user_2',
      eventId: 'evt_1',
      amountCents: 2500,
      currency: 'USD',
      status: PaymentStatus.pending,
    });

    const res = await POST(
      new Request('http://localhost/api/payments/pre-confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          eventId: 'evt_1',
          paymentIntentId: 'pi_1',
        }),
      })
    );

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.errorCode).toBe('PAYMENT_SESSION_INVALID');
    expect(h.prisma.event.findUnique).not.toHaveBeenCalled();
    expect(h.stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });

  it('blocks mismatched event and payment session intent metadata', async () => {
    h.auth.mockResolvedValue({ userId: 'user_1' });
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_1',
      userId: 'user_1',
      eventId: 'evt_1',
      amountCents: 2500,
      currency: 'USD',
      status: PaymentStatus.pending,
    });

    const res = await POST(
      new Request('http://localhost/api/payments/pre-confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          eventId: 'evt_other',
          paymentIntentId: 'pi_1',
        }),
      })
    );

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.errorCode).toBe('PAYMENT_SESSION_INVALID');
    expect(h.prisma.event.findUnique).not.toHaveBeenCalled();
    expect(h.stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });

  it('blocks mismatched Stripe metadata userId', async () => {
    h.auth.mockResolvedValue({ userId: 'user_1' });
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_1',
      userId: 'user_1',
      eventId: 'evt_1',
      amountCents: 2500,
      currency: 'USD',
      status: PaymentStatus.pending,
    });
    h.prisma.event.findUnique.mockResolvedValue({
      id: 'evt_1',
      date: new Date('2099-01-01T10:00:00.000Z'),
      archivedAt: null,
    });
    h.stripe.paymentIntents.retrieve.mockResolvedValue({
      id: 'pi_1',
      status: 'requires_confirmation',
      amount: 2500,
      currency: 'usd',
      metadata: {
        eventId: 'evt_1',
        userId: 'user_2',
      },
    });

    const res = await POST(
      new Request('http://localhost/api/payments/pre-confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          eventId: 'evt_1',
          paymentIntentId: 'pi_1',
        }),
      })
    );

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.errorCode).toBe('PAYMENT_SESSION_INVALID');
  });

  it('blocks amount/currency mismatches between payment record and Stripe intent', async () => {
    h.auth.mockResolvedValue({ userId: 'user_1' });
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_1',
      userId: 'user_1',
      eventId: 'evt_1',
      amountCents: 2500,
      currency: 'USD',
      status: PaymentStatus.pending,
    });
    h.prisma.event.findUnique.mockResolvedValue({
      id: 'evt_1',
      date: new Date('2099-01-01T10:00:00.000Z'),
      archivedAt: null,
    });
    h.stripe.paymentIntents.retrieve.mockResolvedValue({
      id: 'pi_1',
      status: 'requires_confirmation',
      amount: 2500,
      currency: 'ars',
      metadata: {
        eventId: 'evt_1',
        userId: 'user_1',
      },
    });

    const res = await POST(
      new Request('http://localhost/api/payments/pre-confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          eventId: 'evt_1',
          paymentIntentId: 'pi_1',
        }),
      })
    );

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.errorCode).toBe('PAYMENT_SESSION_INVALID');
  });

  it('blocks non-confirmable Stripe payment intent statuses', async () => {
    h.auth.mockResolvedValue({ userId: 'user_1' });
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_1',
      userId: 'user_1',
      eventId: 'evt_1',
      amountCents: 2500,
      currency: 'USD',
      status: PaymentStatus.pending,
    });
    h.prisma.event.findUnique.mockResolvedValue({
      id: 'evt_1',
      date: new Date('2099-01-01T10:00:00.000Z'),
      archivedAt: null,
    });
    h.stripe.paymentIntents.retrieve.mockResolvedValue({
      id: 'pi_1',
      status: 'succeeded',
      amount: 2500,
      currency: 'usd',
      metadata: {
        eventId: 'evt_1',
        userId: 'user_1',
      },
    });

    const res = await POST(
      new Request('http://localhost/api/payments/pre-confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          eventId: 'evt_1',
          paymentIntentId: 'pi_1',
        }),
      })
    );

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.errorCode).toBe('PAYMENT_NOT_CONFIRMABLE');
  });

  it('maps Stripe retrieve failures to STRIPE_API error contract', async () => {
    h.auth.mockResolvedValue({ userId: 'user_1' });
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_1',
      userId: 'user_1',
      eventId: 'evt_1',
      amountCents: 2500,
      currency: 'USD',
      status: PaymentStatus.pending,
    });
    h.prisma.event.findUnique.mockResolvedValue({
      id: 'evt_1',
      date: new Date('2099-01-01T10:00:00.000Z'),
      archivedAt: null,
    });
    h.stripe.paymentIntents.retrieve.mockRejectedValue(
      new Error('Stripe temporarily unavailable')
    );

    const res = await POST(
      new Request('http://localhost/api/payments/pre-confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          eventId: 'evt_1',
          paymentIntentId: 'pi_1',
        }),
      })
    );

    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.errorCode).toBe('STRIPE_API');
  });
});

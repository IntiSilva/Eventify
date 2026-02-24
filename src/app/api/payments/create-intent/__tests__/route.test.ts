import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  prisma: {
    event: { findUnique: vi.fn() },
    payment: { create: vi.fn() },
  },
  stripe: {
    paymentIntents: { create: vi.fn() },
  },
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: h.auth }));
vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }));
vi.mock('@/lib/stripe', () => ({ stripe: h.stripe }));

import { POST } from '@/app/api/payments/create-intent/route';

describe('POST /api/payments/create-intent', () => {
  beforeEach(() => {
    h.auth.mockReset();
    h.prisma.event.findUnique.mockReset();
    h.prisma.payment.create.mockReset();
    h.stripe.paymentIntents.create.mockReset();
  });

  it('creates a payment intent using event pricing and stores Payment row', async () => {
    h.auth.mockResolvedValue({ userId: 'user_1' });
    h.prisma.event.findUnique.mockResolvedValue({
      id: 'evt_1',
      title: 'Paid event',
      isPaid: true,
      priceCents: 2500,
      currency: 'USD',
    });
    h.stripe.paymentIntents.create.mockResolvedValue({ id: 'pi_123', client_secret: 'cs_123' });
    h.prisma.payment.create.mockResolvedValue({ id: 'pay_1' });

    const res = await POST(new Request('http://localhost/api/payments/create-intent', {
      method: 'POST',
      body: JSON.stringify({ eventId: 'evt_1' }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.clientSecret).toBe('cs_123');

    expect(h.stripe.paymentIntents.create).toHaveBeenCalledWith(expect.objectContaining({
      amount: 2500,
      currency: 'usd',
      metadata: { eventId: 'evt_1', userId: 'user_1' },
    }));

    expect(h.prisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        stripePaymentIntentId: 'pi_123',
        amountCents: 2500,
        currency: 'USD',
        eventId: 'evt_1',
        userId: 'user_1',
      }),
    }));
  });
});

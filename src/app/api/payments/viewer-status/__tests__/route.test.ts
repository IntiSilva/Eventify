import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  prisma: {
    payment: {
      findFirst: vi.fn(),
    },
  },
  stripe: {
    refunds: {
      retrieve: vi.fn(),
    },
  },
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: h.auth,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: h.prisma,
}));

vi.mock('@/lib/stripe', () => ({
  stripe: h.stripe,
}));

import { GET } from '@/app/api/payments/viewer-status/route';

describe('GET /api/payments/viewer-status', () => {
  beforeEach(() => {
    h.auth.mockReset();
    h.prisma.payment.findFirst.mockReset();
    h.stripe.refunds.retrieve.mockReset();
    h.auth.mockResolvedValue({ userId: 'user_1' });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 401 when the requester is not authenticated', async () => {
    h.auth.mockResolvedValue({ userId: null });

    const res = await GET(
      new Request('http://localhost/api/payments/viewer-status?eventId=evt_1')
    );
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(json).toEqual({ error: 'Unauthorized' });
    expect(h.prisma.payment.findFirst).not.toHaveBeenCalled();
  });

  it('returns 400 when eventId is missing', async () => {
    const res = await GET(
      new Request('http://localhost/api/payments/viewer-status')
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(json).toEqual({ error: 'Missing eventId' });
    expect(h.prisma.payment.findFirst).not.toHaveBeenCalled();
  });

  it('returns paid ticketState and omits debug payout fields in production', async () => {
    h.prisma.payment.findFirst.mockResolvedValue({
      id: 'pay_1',
      amountCents: 5000,
      currency: 'USD',
      createdAt: new Date('2026-03-02T12:00:00.000Z'),
      payoutTarget: 'organizer',
      destinationAccountId: 'acct_test_123',
      refundRequest: null,
    });
    vi.stubEnv('NODE_ENV', 'production');

    const res = await GET(
      new Request('http://localhost/api/payments/viewer-status?eventId=evt_1')
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(json).toEqual({
      eventId: 'evt_1',
      ticketState: 'paid',
      alreadyPaid: true,
      payment: {
        amountCents: 5000,
        currency: 'USD',
        paidAt: '2026-03-02T12:00:00.000Z',
      },
    });
    expect(h.stripe.refunds.retrieve).not.toHaveBeenCalled();
  });

  it('returns refund_pending when refund request is in-flight', async () => {
    h.prisma.payment.findFirst.mockResolvedValue({
      id: 'pay_1',
      amountCents: 5000,
      currency: 'USD',
      createdAt: new Date('2026-03-02T12:00:00.000Z'),
      payoutTarget: 'organizer',
      destinationAccountId: 'acct_test_123',
      refundRequest: {
        status: 'processing',
        stripeRefundId: 're_1',
      },
    });
    vi.stubEnv('NODE_ENV', 'development');

    const res = await GET(
      new Request('http://localhost/api/payments/viewer-status?eventId=evt_1')
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      eventId: 'evt_1',
      ticketState: 'refund_pending',
      alreadyPaid: false,
      payment: {
        amountCents: 5000,
        currency: 'USD',
        paidAt: '2026-03-02T12:00:00.000Z',
        payoutTarget: 'organizer',
        destinationAccountId: 'acct_test_123',
      },
    });
    expect(h.stripe.refunds.retrieve).not.toHaveBeenCalled();
  });

  it('returns refunded when succeeded refund is full amount', async () => {
    h.prisma.payment.findFirst.mockResolvedValue({
      id: 'pay_1',
      amountCents: 5000,
      currency: 'USD',
      createdAt: new Date('2026-03-02T12:00:00.000Z'),
      payoutTarget: 'organizer',
      destinationAccountId: 'acct_test_123',
      refundRequest: {
        status: 'succeeded',
        stripeRefundId: 're_full',
      },
    });
    h.stripe.refunds.retrieve.mockResolvedValue({
      id: 're_full',
      amount: 5000,
    });

    const res = await GET(
      new Request('http://localhost/api/payments/viewer-status?eventId=evt_1')
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ticketState).toBe('refunded');
    expect(json.alreadyPaid).toBe(false);
    expect(h.stripe.refunds.retrieve).toHaveBeenCalledWith('re_full');
  });

  it('keeps paid state when succeeded refund is partial', async () => {
    h.prisma.payment.findFirst.mockResolvedValue({
      id: 'pay_1',
      amountCents: 5000,
      currency: 'USD',
      createdAt: new Date('2026-03-02T12:00:00.000Z'),
      payoutTarget: 'organizer',
      destinationAccountId: 'acct_test_123',
      refundRequest: {
        status: 'succeeded',
        stripeRefundId: 're_partial',
      },
    });
    h.stripe.refunds.retrieve.mockResolvedValue({
      id: 're_partial',
      amount: 1200,
    });

    const res = await GET(
      new Request('http://localhost/api/payments/viewer-status?eventId=evt_1')
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ticketState).toBe('paid');
    expect(json.alreadyPaid).toBe(true);
  });

  it('returns none when no succeeded payment exists', async () => {
    h.prisma.payment.findFirst.mockResolvedValue(null);

    const res = await GET(
      new Request('http://localhost/api/payments/viewer-status?eventId=evt_1')
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      eventId: 'evt_1',
      ticketState: 'none',
      alreadyPaid: false,
      payment: undefined,
    });
  });
});

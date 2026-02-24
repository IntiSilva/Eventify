import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  createOrReusePaymentIntentForEvent: vi.fn(),
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: h.auth }));
vi.mock('@/lib/payments/intent', () => ({
  createOrReusePaymentIntentForEvent: h.createOrReusePaymentIntentForEvent,
}));

import { POST } from '@/app/api/payments/create-intent/route';

describe('POST /api/payments/create-intent', () => {
  beforeEach(() => {
    h.auth.mockReset();
    h.createOrReusePaymentIntentForEvent.mockReset();
  });

  it('delegates to payment-intent service and returns unified ticket-state payload', async () => {
    h.auth.mockResolvedValue({ userId: 'user_1' });
    h.createOrReusePaymentIntentForEvent.mockResolvedValue({
      state: 'PAYMENT_IN_PROGRESS',
      clientSecret: 'cs_123',
      paymentIntentId: 'pi_123',
      publishableKey: 'pk_test_123',
      event: {
        id: 'evt_1',
        title: 'Paid event',
      },
    });

    const res = await POST(new Request('http://localhost/api/payments/create-intent', {
      method: 'POST',
      body: JSON.stringify({ eventId: 'evt_1' }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.clientSecret).toBe('cs_123');
    expect(json.data.paymentIntentId).toBe('pi_123');

    expect(h.createOrReusePaymentIntentForEvent).toHaveBeenCalledWith({
      eventId: 'evt_1',
      userId: 'user_1',
    });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  stripe: {
    webhooks: {
      constructEvent: vi.fn(),
    },
  },
  getStripeWebhookSecret: vi.fn(),
  confirmPaidRsvpByIntent: vi.fn(),
  markPaymentFailed: vi.fn(),
}));

vi.mock('@/lib/stripe', () => ({
  stripe: h.stripe,
  getStripeWebhookSecret: h.getStripeWebhookSecret,
}));
vi.mock('@/lib/payments/confirmPaidRsvp', () => ({
  confirmPaidRsvpByIntent: h.confirmPaidRsvpByIntent,
  markPaymentFailed: h.markPaymentFailed,
}));

import { POST } from '@/app/api/webhooks/stripe/route';

describe('POST /api/webhooks/stripe', () => {
  beforeEach(() => {
    h.getStripeWebhookSecret.mockReset();
    h.stripe.webhooks.constructEvent.mockReset();
    h.confirmPaidRsvpByIntent.mockReset();
    h.markPaymentFailed.mockReset();
    h.getStripeWebhookSecret.mockReturnValue('whsec_test');
  });

  it('handles payment_intent.succeeded and calls confirm service', async () => {
    h.stripe.webhooks.constructEvent.mockReturnValue({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_123' } },
    });

    const res = await POST(new Request('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      body: '{}',
      headers: { 'stripe-signature': 'sig_test' },
    }));

    expect(res.status).toBe(200);
    expect(h.confirmPaidRsvpByIntent).toHaveBeenCalledWith('pi_123');
    expect(h.markPaymentFailed).not.toHaveBeenCalled();
  });
});

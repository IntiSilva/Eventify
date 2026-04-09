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
  markPaymentProcessing: vi.fn(),
  markPaymentCanceled: vi.fn(),
  syncRefundRequestFromStripeRefund: vi.fn(),
}));

vi.mock('@/lib/stripe', () => ({
  stripe: h.stripe,
  getStripeWebhookSecret: h.getStripeWebhookSecret,
}));
vi.mock('@/lib/payments/confirmPaidRsvp', () => ({
  confirmPaidRsvpByIntent: h.confirmPaidRsvpByIntent,
  markPaymentFailed: h.markPaymentFailed,
  markPaymentProcessing: h.markPaymentProcessing,
  markPaymentCanceled: h.markPaymentCanceled,
}));
vi.mock('@/lib/payments/refunds', () => ({
  syncRefundRequestFromStripeRefund: h.syncRefundRequestFromStripeRefund,
}));

import { POST } from '@/app/api/webhooks/stripe/route';

const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

describe('POST /api/webhooks/stripe', () => {
  beforeEach(() => {
    h.getStripeWebhookSecret.mockReset();
    h.stripe.webhooks.constructEvent.mockReset();
    h.confirmPaidRsvpByIntent.mockReset();
    h.markPaymentFailed.mockReset();
    h.markPaymentProcessing.mockReset();
    h.markPaymentCanceled.mockReset();
    h.syncRefundRequestFromStripeRefund.mockReset();
    h.getStripeWebhookSecret.mockReturnValue('whsec_test');
    consoleWarnSpy.mockClear();
    consoleInfoSpy.mockClear();
  });

  it('returns 400 when stripe-signature header is missing and does not call handlers', async () => {
    const res = await POST(new Request('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      body: '{}',
    }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({
      success: false,
      error: 'Missing stripe-signature header',
    });
    expect(h.stripe.webhooks.constructEvent).not.toHaveBeenCalled();
    expect(h.confirmPaidRsvpByIntent).not.toHaveBeenCalled();
    expect(h.markPaymentProcessing).not.toHaveBeenCalled();
    expect(h.markPaymentCanceled).not.toHaveBeenCalled();
    expect(h.markPaymentFailed).not.toHaveBeenCalled();
    expect(h.syncRefundRequestFromStripeRefund).not.toHaveBeenCalled();
  });

  it('returns 400 when stripe signature is invalid and does not call handlers', async () => {
    h.stripe.webhooks.constructEvent.mockImplementation(() => {
      throw new Error('Signature mismatch');
    });

    const res = await POST(new Request('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      body: '{}',
      headers: { 'stripe-signature': 'sig_bad' },
    }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({
      success: false,
      error: 'Signature mismatch',
    });
    expect(h.confirmPaidRsvpByIntent).not.toHaveBeenCalled();
    expect(h.markPaymentProcessing).not.toHaveBeenCalled();
    expect(h.markPaymentCanceled).not.toHaveBeenCalled();
    expect(h.markPaymentFailed).not.toHaveBeenCalled();
    expect(h.syncRefundRequestFromStripeRefund).not.toHaveBeenCalled();
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
    expect(h.confirmPaidRsvpByIntent).toHaveBeenCalledWith(
      'pi_123',
      expect.objectContaining({ id: 'pi_123' })
    );
    expect(h.markPaymentFailed).not.toHaveBeenCalled();
  });

  it('handles refund.updated and syncs the refund request', async () => {
    h.stripe.webhooks.constructEvent.mockReturnValue({
      type: 'refund.updated',
      data: { object: { id: 're_123', status: 'succeeded' } },
    });

    const res = await POST(new Request('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      body: '{}',
      headers: { 'stripe-signature': 'sig_test' },
    }));

    expect(res.status).toBe(200);
    expect(h.syncRefundRequestFromStripeRefund).toHaveBeenCalledWith(
      expect.objectContaining({ id: 're_123', status: 'succeeded' })
    );
  });

  it('dispatches payment_intent.processing to markPaymentProcessing', async () => {
    h.stripe.webhooks.constructEvent.mockReturnValue({
      type: 'payment_intent.processing',
      data: { object: { id: 'pi_processing' } },
    });

    const res = await POST(new Request('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      body: '{}',
      headers: { 'stripe-signature': 'sig_test' },
    }));

    expect(res.status).toBe(200);
    expect(h.markPaymentProcessing).toHaveBeenCalledWith('pi_processing');
    expect(h.markPaymentCanceled).not.toHaveBeenCalled();
    expect(h.markPaymentFailed).not.toHaveBeenCalled();
  });

  it('dispatches payment_intent.canceled to markPaymentCanceled', async () => {
    h.stripe.webhooks.constructEvent.mockReturnValue({
      type: 'payment_intent.canceled',
      data: { object: { id: 'pi_canceled' } },
    });

    const res = await POST(new Request('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      body: '{}',
      headers: { 'stripe-signature': 'sig_test' },
    }));

    expect(res.status).toBe(200);
    expect(h.markPaymentCanceled).toHaveBeenCalledWith('pi_canceled');
    expect(h.markPaymentProcessing).not.toHaveBeenCalled();
    expect(h.markPaymentFailed).not.toHaveBeenCalled();
  });

  it('dispatches payment_intent.payment_failed to markPaymentFailed', async () => {
    h.stripe.webhooks.constructEvent.mockReturnValue({
      type: 'payment_intent.payment_failed',
      data: { object: { id: 'pi_failed' } },
    });

    const res = await POST(new Request('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      body: '{}',
      headers: { 'stripe-signature': 'sig_test' },
    }));

    expect(res.status).toBe(200);
    expect(h.markPaymentFailed).toHaveBeenCalledWith('pi_failed');
    expect(h.markPaymentProcessing).not.toHaveBeenCalled();
    expect(h.markPaymentCanceled).not.toHaveBeenCalled();
  });

  it('returns 500 when refund sync throws so Stripe can retry', async () => {
    h.stripe.webhooks.constructEvent.mockReturnValue({
      type: 'refund.updated',
      data: { object: { id: 're_123', status: 'succeeded' } },
    });
    h.syncRefundRequestFromStripeRefund.mockRejectedValue(new Error('Brevo down'));

    const res = await POST(new Request('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      body: '{}',
      headers: { 'stripe-signature': 'sig_test' },
    }));

    expect(res.status).toBe(500);
  });

  it('handles dispute events with structured logging only', async () => {
    h.stripe.webhooks.constructEvent.mockReturnValue({
      type: 'charge.dispute.created',
      data: {
        object: {
          id: 'dp_123',
          charge: 'ch_123',
          payment_intent: 'pi_123',
          status: 'warning_needs_response',
          reason: 'fraudulent',
        },
      },
    });

    const res = await POST(new Request('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      body: '{}',
      headers: { 'stripe-signature': 'sig_test' },
    }));

    expect(res.status).toBe(200);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[stripe-dispute] charge.dispute.created disputeId=dp_123 chargeId=ch_123 paymentIntentId=pi_123 status=warning_needs_response reason=fraudulent'
    );
  });
});

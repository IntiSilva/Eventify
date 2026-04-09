import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  stripe: {
    webhooks: {
      constructEvent: vi.fn(),
    },
  },
  getStripeConnectWebhookSecret: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock('@/lib/stripe', () => ({
  stripe: h.stripe,
  getStripeConnectWebhookSecret: h.getStripeConnectWebhookSecret,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: h.findUnique,
      updateMany: h.updateMany,
    },
  },
}));

import { POST } from '@/app/api/webhooks/stripe-connect/route';

const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

describe('POST /api/webhooks/stripe-connect', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T15:00:00.000Z'));

    h.getStripeConnectWebhookSecret.mockReset();
    h.stripe.webhooks.constructEvent.mockReset();
    h.findUnique.mockReset();
    h.updateMany.mockReset();

    h.getStripeConnectWebhookSecret.mockReturnValue('whsec_connect_test');
    consoleWarnSpy.mockClear();
    consoleErrorSpy.mockClear();
  });

  it('uses metadata clerkId to sync readiness and sets onboardingCompletedAt only when fully ready', async () => {
    h.stripe.webhooks.constructEvent.mockReturnValue({
      type: 'account.updated',
      data: {
        object: {
          id: 'acct_123',
          charges_enabled: true,
          payouts_enabled: true,
          details_submitted: true,
          metadata: {
            clerkId: 'org_123',
          },
        },
      },
    });
    h.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ stripeConnectAccountId: null });
    h.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });

    const res = await POST(
      new Request('http://localhost/api/webhooks/stripe-connect', {
        method: 'POST',
        body: '{}',
        headers: { 'stripe-signature': 'sig_test' },
      })
    );

    expect(res.status).toBe(200);
    expect(h.updateMany).toHaveBeenCalledTimes(2);
    expect(h.updateMany).toHaveBeenNthCalledWith(1, {
      where: { clerkId: 'org_123' },
      data: {
        stripeConnectAccountId: 'acct_123',
        stripeConnectChargesEnabled: true,
        stripeConnectPayoutsEnabled: true,
        stripeConnectDetailsSubmitted: true,
        stripeConnectStatusUpdatedAt: new Date('2026-03-01T15:00:00.000Z'),
      },
    });
    expect(h.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        clerkId: 'org_123',
        stripeConnectOnboardingCompletedAt: null,
      },
      data: {
        stripeConnectOnboardingCompletedAt: new Date('2026-03-01T15:00:00.000Z'),
      },
    });
  });

  it('does not set onboardingCompletedAt until the account is fully ready', async () => {
    h.stripe.webhooks.constructEvent.mockReturnValue({
      type: 'account.updated',
      data: {
        object: {
          id: 'acct_123',
          charges_enabled: true,
          payouts_enabled: false,
          details_submitted: true,
          metadata: {
            clerkId: 'org_123',
          },
        },
      },
    });
    h.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ stripeConnectAccountId: null });
    h.updateMany.mockResolvedValueOnce({ count: 1 });

    const res = await POST(
      new Request('http://localhost/api/webhooks/stripe-connect', {
        method: 'POST',
        body: '{}',
        headers: { 'stripe-signature': 'sig_test' },
      })
    );

    expect(res.status).toBe(200);
    expect(h.updateMany).toHaveBeenCalledTimes(1);
    expect(h.updateMany).toHaveBeenCalledWith({
      where: { clerkId: 'org_123' },
      data: {
        stripeConnectAccountId: 'acct_123',
        stripeConnectChargesEnabled: true,
        stripeConnectPayoutsEnabled: false,
        stripeConnectDetailsSubmitted: true,
        stripeConnectStatusUpdatedAt: new Date('2026-03-01T15:00:00.000Z'),
      },
    });
  });

  it('returns 500 when metadata clerkId is present but no user row matches', async () => {
    h.stripe.webhooks.constructEvent.mockReturnValue({
      type: 'account.updated',
      data: {
        object: {
          id: 'acct_123',
          charges_enabled: true,
          payouts_enabled: true,
          details_submitted: true,
          metadata: {
            clerkId: 'org_missing',
          },
        },
      },
    });
    h.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    h.updateMany.mockResolvedValueOnce({ count: 0 });

    const res = await POST(
      new Request('http://localhost/api/webhooks/stripe-connect', {
        method: 'POST',
        body: '{}',
        headers: { 'stripe-signature': 'sig_test' },
      })
    );

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      success: false,
      error: 'Webhook handling failed',
    });
    expect(h.updateMany).toHaveBeenCalledTimes(1);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[stripe-connect-webhook] no user found for clerkId=org_missing account=acct_123; returning 500 so Stripe retries'
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[POST /api/webhooks/stripe-connect] failed to process account.updated',
      expect.any(Error)
    );
  });

  it('returns 500 when metadata clerkId is already bound to a different account id', async () => {
    h.stripe.webhooks.constructEvent.mockReturnValue({
      type: 'account.updated',
      data: {
        object: {
          id: 'acct_new',
          charges_enabled: true,
          payouts_enabled: true,
          details_submitted: true,
          metadata: {
            clerkId: 'org_123',
          },
        },
      },
    });
    h.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ stripeConnectAccountId: 'acct_old' });

    const res = await POST(
      new Request('http://localhost/api/webhooks/stripe-connect', {
        method: 'POST',
        body: '{}',
        headers: { 'stripe-signature': 'sig_test' },
      })
    );

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      success: false,
      error: 'Webhook handling failed',
    });
    expect(h.updateMany).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[stripe-connect-webhook] clerkId=org_123 is already bound to account acct_old; refusing reassignment to account acct_new; returning 500 so Stripe retries'
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[POST /api/webhooks/stripe-connect] failed to process account.updated',
      expect.any(Error)
    );
  });

  it('returns 500 when incoming account id is already bound to a different clerkId', async () => {
    h.stripe.webhooks.constructEvent.mockReturnValue({
      type: 'account.updated',
      data: {
        object: {
          id: 'acct_existing',
          charges_enabled: true,
          payouts_enabled: true,
          details_submitted: true,
          metadata: {
            clerkId: 'org_123',
          },
        },
      },
    });
    h.findUnique.mockResolvedValueOnce({ clerkId: 'org_other' });

    const res = await POST(
      new Request('http://localhost/api/webhooks/stripe-connect', {
        method: 'POST',
        body: '{}',
        headers: { 'stripe-signature': 'sig_test' },
      })
    );

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      success: false,
      error: 'Webhook handling failed',
    });
    expect(h.updateMany).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[stripe-connect-webhook] account acct_existing is already bound to clerkId=org_other; refusing metadata reassignment to clerkId=org_123; returning 500 so Stripe retries'
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[POST /api/webhooks/stripe-connect] failed to process account.updated',
      expect.any(Error)
    );
  });

  it('returns 500 when prisma sync throws so Stripe retries', async () => {
    h.stripe.webhooks.constructEvent.mockReturnValue({
      type: 'account.updated',
      data: {
        object: {
          id: 'acct_123',
          charges_enabled: true,
          payouts_enabled: true,
          details_submitted: true,
          metadata: {
            clerkId: 'org_123',
          },
        },
      },
    });
    h.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ stripeConnectAccountId: null });
    h.updateMany.mockRejectedValueOnce(new Error('DB unavailable'));

    const res = await POST(
      new Request('http://localhost/api/webhooks/stripe-connect', {
        method: 'POST',
        body: '{}',
        headers: { 'stripe-signature': 'sig_test' },
      })
    );

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      success: false,
      error: 'Webhook handling failed',
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[POST /api/webhooks/stripe-connect] failed to process account.updated',
      expect.any(Error)
    );
  });

  it('returns 400 when signature verification fails', async () => {
    h.stripe.webhooks.constructEvent.mockImplementation(() => {
      throw new Error('Signature mismatch');
    });

    const res = await POST(
      new Request('http://localhost/api/webhooks/stripe-connect', {
        method: 'POST',
        body: '{}',
        headers: { 'stripe-signature': 'sig_test' },
      })
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      success: false,
      error: 'Signature mismatch',
    });
    expect(h.findUnique).not.toHaveBeenCalled();
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it('falls back to stripeConnectAccountId lookup when metadata is missing', async () => {
    h.stripe.webhooks.constructEvent.mockReturnValue({
      type: 'account.updated',
      data: {
        object: {
          id: 'acct_external',
          charges_enabled: false,
          payouts_enabled: false,
          details_submitted: false,
          metadata: {},
        },
      },
    });
    h.updateMany.mockResolvedValueOnce({ count: 0 });

    const res = await POST(
      new Request('http://localhost/api/webhooks/stripe-connect', {
        method: 'POST',
        body: '{}',
        headers: { 'stripe-signature': 'sig_test' },
      })
    );

    expect(res.status).toBe(200);
    expect(h.updateMany).toHaveBeenCalledTimes(1);
    expect(h.updateMany).toHaveBeenCalledWith({
      where: { stripeConnectAccountId: 'acct_external' },
      data: {
        stripeConnectAccountId: 'acct_external',
        stripeConnectChargesEnabled: false,
        stripeConnectPayoutsEnabled: false,
        stripeConnectDetailsSubmitted: false,
        stripeConnectStatusUpdatedAt: new Date('2026-03-01T15:00:00.000Z'),
      },
    });
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[stripe-connect-webhook] no user found for connected account acct_external'
    );
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});

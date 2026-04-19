import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const ORIGINAL_STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const ORIGINAL_STRIPE_CONNECT_WEBHOOK_SECRET = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;

function restoreEnv(name: string, value: string | undefined) {
  if (typeof value === 'undefined') {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

describe('lib/stripe lazy initialization', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  });

  afterEach(() => {
    restoreEnv('STRIPE_SECRET_KEY', ORIGINAL_STRIPE_SECRET_KEY);
    restoreEnv('STRIPE_WEBHOOK_SECRET', ORIGINAL_STRIPE_WEBHOOK_SECRET);
    restoreEnv('STRIPE_CONNECT_WEBHOOK_SECRET', ORIGINAL_STRIPE_CONNECT_WEBHOOK_SECRET);
  });

  it('does not require STRIPE_SECRET_KEY on module import', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(import('@/lib/stripe')).resolves.toBeDefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('fails lazily and clearly when Stripe is accessed without STRIPE_SECRET_KEY', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { assertStripeConfigured, getStripe, stripe } = await import('@/lib/stripe');
    const expectedMessage = '[stripe] STRIPE_SECRET_KEY is not configured.';

    expect(() => assertStripeConfigured()).toThrow(expectedMessage);
    expect(() => getStripe()).toThrow(expectedMessage);
    expect(() => stripe.webhooks).toThrow(expectedMessage);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('memoizes the Stripe client when configured', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_1234567890';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { getStripe } = await import('@/lib/stripe');

    const first = getStripe();
    const second = getStripe();

    expect(first).toBe(second);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('validates webhook secrets only when requested', async () => {
    const { getStripeWebhookSecret, getStripeConnectWebhookSecret } = await import('@/lib/stripe');

    expect(() => getStripeWebhookSecret()).toThrow('Missing STRIPE_WEBHOOK_SECRET');
    expect(() => getStripeConnectWebhookSecret()).toThrow(
      'Missing STRIPE_CONNECT_WEBHOOK_SECRET'
    );

    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_connect_test';

    expect(getStripeWebhookSecret()).toBe('whsec_test');
    expect(getStripeConnectWebhookSecret()).toBe('whsec_connect_test');
  });
});

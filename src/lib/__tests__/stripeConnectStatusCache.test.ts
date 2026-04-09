import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STRIPE_CONNECT_STATUS_CACHE_TTL_MS,
  clearStripeConnectStatusInflight,
  getCachedStripeConnectStatus,
  getFreshStripeConnectStatus,
  getStripeConnectStatusInflight,
  invalidateStripeConnectStatusCache,
  isStripeConnectStatusCacheStale,
  setCachedStripeConnectStatus,
  setStripeConnectStatusInflight,
} from '@/lib/stripeConnectStatusCache';

const statusFixture = {
  accountId: 'acct_123',
  chargesEnabled: true,
  payoutsEnabled: true,
  detailsSubmitted: true,
  onboardingCompletedAt: '2026-03-12T10:00:00.000Z',
  statusUpdatedAt: '2026-03-12T10:00:00.000Z',
} as const;

describe('stripeConnectStatusCache', () => {
  beforeEach(() => {
    invalidateStripeConnectStatusCache();
    clearStripeConnectStatusInflight();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores and returns a fresh cached status', () => {
    setCachedStripeConnectStatus(statusFixture);

    expect(getCachedStripeConnectStatus()).toEqual(statusFixture);
    expect(getFreshStripeConnectStatus()).toEqual(statusFixture);
    expect(isStripeConnectStatusCacheStale()).toBe(false);
  });

  it('treats cache entries as stale after ttl', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-12T10:00:00.000Z'));

    setCachedStripeConnectStatus(statusFixture);
    vi.setSystemTime(new Date('2026-03-12T10:02:00.001Z'));

    expect(isStripeConnectStatusCacheStale(STRIPE_CONNECT_STATUS_CACHE_TTL_MS)).toBe(true);
    expect(getFreshStripeConnectStatus()).toBeUndefined();
  });

  it('tracks inflight promises and allows explicit clear', async () => {
    const inflight = Promise.resolve(statusFixture);
    setStripeConnectStatusInflight(inflight);

    expect(getStripeConnectStatusInflight()).toBe(inflight);

    await inflight;
    clearStripeConnectStatusInflight();
    expect(getStripeConnectStatusInflight()).toBeNull();
  });
});
